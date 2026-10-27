"""Execute the shipped action/install body against a bounded fake remote disk."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
RESERVE_KB = 1048576


def block(path: Path, marker: str, indent: int) -> str:
    lines = path.read_text().splitlines()
    start = lines.index(marker) + 1
    body = []
    for line in lines[start:]:
        if line and not line.startswith(' ' * indent):
            break
        body.append(line[indent:])
    return '\n'.join(body) + '\n'


def sparse_archive(path: Path, payload_kb: int) -> None:
    """One ordinary layer file; sparse fixture needs no multi-GB allocation."""
    layer_header = tarfile.TarInfo('payload'); layer_header.size = payload_kb * 1024
    layer_size = 512 + layer_header.size + 1024
    manifest = json.dumps([{'Config': 'config.json', 'RepoTags': ['fixture:tag'], 'Layers': ['layer.tar']}]).encode()
    with path.open('wb') as output:
        for name, content in [('manifest.json', manifest), ('config.json', json.dumps({'os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+'a'*64]}}).encode())]:
            header = tarfile.TarInfo(name); header.size = len(content)
            output.write(header.tobuf()); output.write(content)
            output.write(b'\0' * (-len(content) % 512))
        header = tarfile.TarInfo('layer.tar'); header.size = layer_size
        output.write(header.tobuf()); output.write(layer_header.tobuf())
        output.seek(layer_header.size, 1); output.write(b'\0' * 1024)
        output.write(b'\0' * (-layer_size % 512 + 1024))


class ImageShippingTest(unittest.TestCase):
    def ship(self, *, free_kb: int = 10200000, payload_kb: int = 3047550,
             after_upload_kb: int | None = None, metadata: str | None = None,
             docker_free_kb: int | None = None, install_failure: bool = False,
             cancel: bool = False, invalid_df: bool = False,
             low_path: str = '/var/lib/containerd', block_size: str = '4096',
             docker_version: str = '29.1.3', containerd_version: str = '2.2.2', inode_free: int = 1000000,
             unpack_error: bool = False, existing_stage: bool = False, bad_staging: bool = False, ambiguous_mount: bool = False, archive_bytes: bytes | None = None) -> dict:
        with tempfile.TemporaryDirectory(dir=ROOT/'deploy/tests') as folder:
            root = Path(folder); app = root/'app'; runner = root/'runner'; binaries = root/'bin'
            for directory in (app, runner, binaries): directory.mkdir()
            archive = runner/'fluxradar-api.tar'
            if archive_bytes is None: sparse_archive(archive, payload_kb)
            else: archive.write_bytes(archive_bytes)
            # Independent producer model: SCP writes the apparent archive; import
            # retains the complete layer tar and unpack writes its file payload.
            archive_kb = (archive.stat().st_size + 1023) // 1024
            state = root/'state.json'
            state.write_text(json.dumps({'free': free_kb, 'events': [], 'peak': free_kb}))
            sibling = app/'incoming'/('a'*40)/'other'; sibling.mkdir(parents=True)
            (sibling/'keep').write_text('untouched')
            stage = sibling.parent/'api-image'
            if existing_stage:
                stage.mkdir(); (stage/'preexisting').write_text('keep')
            dispatch = root/'stub.py'
            dispatch.write_text('''import json, os, pathlib, subprocess, sys, signal
name=pathlib.Path(sys.argv[1]).name; args=sys.argv[2:]; state=pathlib.Path(os.environ['STATE'])
data=json.loads(state.read_text())
def save(): state.write_text(json.dumps(data))
if name=='ssh':
    result=subprocess.run(['bash','-c',' '.join(args[1:])]); sys.exit(result.returncode)
if name=='du': print(os.environ['ARCHIVE_KB']+'\\ttotal')
elif name=='df':
    available=data['free']
    if os.environ.get('INVALID_DF'): available='unknown'
    if os.environ['LOW_PATH'] in args and os.environ.get('DOCKER_FREE'): available=os.environ['DOCKER_FREE']
    if '-i' in args: available=os.environ['INODE_FREE']
    print('Filesystem 1024-blocks Used Available Capacity Mounted on')
    print('/dev/x 40000000 0 '+str(available)+' 0% /')
elif name=='readlink':
    print('/other/filesystem' if os.environ.get('BAD_STAGING') and '/incoming' in args[-1] else args[-1])
elif name=='findmnt':
    print('/ 8:1 ext4')
    print('/var/lib/docker/rootfs/overlayfs/'+'a'*64+' 0:65 overlay')
    if os.environ.get('AMBIGUOUS'): print('/ 8:2 ext4')
    if os.environ.get('DOCKER_FREE'): print(os.environ['LOW_PATH']+' 8:2 ext4')
elif name=='stat':
    if '%d' in args: print('2050' if '/var/lib/containerd' in args else '2049')
    elif '%T' in args: print('ext2/ext3')
    else: print(os.environ['BLOCK_SIZE'])
elif name=='containerd':
    print('containerd github.com/containerd/containerd/v2 '+os.environ['CONTAINERD_VERSION'] if args[0]=='--version' else 'root = "/var/lib/containerd"')
elif name=='ps': print('/usr/bin/containerd')
elif name=='docker':
    if args[0]=='context': print('default' if args[1]=='show' else 'unix:///var/run/docker.sock')
    elif args[0]=='version': print(os.environ['DOCKER_VERSION'])
    elif args[0]=='info': print('/var/lib/docker|overlayfs|[["driver-type","io.containerd.snapshotter.v1"]]')
    elif args[0]=='load':
        data['events'].append('load')
        data['free']-=int(os.environ['IMPORT_KB'])+int(os.environ['PAYLOAD_KB'])
        data['peak']=min(data['peak'],data['free']); save()
        if os.environ.get('UNPACK_ERROR'): print('Error unpacking image fixture: no space left on device')
        if os.environ.get('INSTALL_FAILURE'): sys.exit(7)
elif name=='scp':
    data['events'].append('upload'); data['free']-=int(os.environ['ARCHIVE_KB'])
    if os.environ.get('AFTER_UPLOAD'): data['free']=int(os.environ['AFTER_UPLOAD'])
    data['peak']=min(data['peak'],data['free']); save()
    if os.environ.get('CANCEL'): os.kill(os.getppid(), signal.SIGTERM)
''')
            for name in ('ssh', 'scp', 'df', 'du', 'docker', 'containerd', 'stat', 'ps', 'findmnt', 'readlink'):
                target = binaries/name
                target.write_text(f'#!/usr/bin/env bash\nexec python3 "{dispatch}" "$0" "$@"\n')
                target.chmod(0o755)
            action = root/'action.sh'
            action.write_text(block(ROOT/'.github/actions/remote-upload/action.yml', '      run: |', 8))
            install = block(ROOT/'.github/workflows/deploy.yml', '          install: |', 12).replace('${{ matrix.service }}', 'api')
            env = {**os.environ, 'PATH':f'{binaries}:{os.environ["PATH"]}', 'RUNNER_TEMP':str(runner),
                   'APP_DIR':str(app), 'SSH_HOST':'fixture', 'SSH_USER':'test', 'RELEASE_ID':'a'*40,
                   'STAGE':'api-image', 'UPLOAD_FILES':str(archive), 'INSTALL_SCRIPT':install,
                   'STATE':str(state), 'ARCHIVE_KB':str(archive_kb), 'IMPORT_KB':str(payload_kb+2),
                   'PAYLOAD_KB':str(payload_kb), 'IMAGE_ARCHIVE':str(archive),
                   'AFTER_UPLOAD':str(after_upload_kb) if after_upload_kb is not None else '',
                   'DOCKER_FREE':str(docker_free_kb) if docker_free_kb is not None else '',
                   'INSTALL_FAILURE':'1' if install_failure else '', 'CANCEL':'1' if cancel else '',
                   'INVALID_DF':'1' if invalid_df else '', 'LOW_PATH':low_path,
                   'BLOCK_SIZE':block_size, 'DOCKER_VERSION':docker_version, 'CONTAINERD_VERSION':containerd_version,
                   'INODE_FREE':str(inode_free), 'UNPACK_ERROR':'1' if unpack_error else '',
                   'BAD_STAGING':'1' if bad_staging else '', 'AMBIGUOUS':'1' if ambiguous_mount else ''}
            if metadata is not None:
                # Corrupt only the producer's stdout, exercising the real shell
                # boundary validation without adding an override to production.
                wrapper = binaries/'python3'
                wrapper.write_text("#!/usr/bin/env bash\nif [ \"${1:-}\" = deploy/image-space.py ]; then printf '%s\\n' \"$BAD_METADATA\"; else exec " + repr(sys.executable) + ' "$@"; fi\n')
                wrapper.chmod(0o755)
                env['BAD_METADATA'] = metadata
            result = subprocess.run(['bash', str(action)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=15)
            return {**json.loads(state.read_text()), 'code':result.returncode,
                    'output':result.stdout+result.stderr,
                    'stage_exists':(app/'incoming'/('a'*40)/'api-image').exists(),
                    'sibling':(sibling/'keep').read_text(), 'preexisting':(stage/'preexisting').exists()}

    def test_mismatched_oci_identity_refuses_before_staging_or_upload(self) -> None:
        from test_image_space import oci_archive
        result = self.ship(archive_bytes=oci_archive(corrupt='short-layer'))
        self.assertNotEqual(result['code'],0,result)
        self.assertEqual(result['events'],[],result)
        self.assertFalse(result['stage_exists'])

    def test_ambiguous_json_refuses_before_staging_or_upload(self) -> None:
        from test_image_space import oci_archive
        for case in ('manifest-layers','descriptor-digest','exact-duplicate'):
            with self.subTest(case=case):
                result = self.ship(archive_bytes=oci_archive(ambiguous=case))
                self.assertNotEqual(result['code'],0,result)
                self.assertEqual(result['events'],[],result)
                self.assertFalse(result['stage_exists'])

    def test_recorded_unsafe_budget_is_rejected_before_upload(self) -> None:
        result = self.ship(free_kb=7798288)
        self.assertNotEqual(result['code'], 0, result)
        self.assertEqual(result['events'], [], result)

    def test_safe_load_keeps_reserve_at_peak(self) -> None:
        result = self.ship()
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(result['events'], ['upload','load'])
        self.assertGreaterEqual(result['peak'], RESERVE_KB)
        self.assertFalse(result['stage_exists']); self.assertEqual(result['sibling'], 'untouched')

    def test_rechecks_after_copy_before_load(self) -> None:
        result = self.ship(after_upload_kb=2000000)
        self.assertNotEqual(result['code'], 0, result)
        self.assertEqual(result['events'], ['upload'], result)
        self.assertFalse(result['stage_exists'])

    def test_invalid_metadata_fails_closed(self) -> None:
        for metadata in ('', '-1 0 1', 'x', '1 2 9223372036854775808'):
            with self.subTest(metadata=metadata):
                result = self.ship(metadata=metadata)
                self.assertNotEqual(result['code'], 0, result)
                self.assertEqual(result['events'], [], result)

    def test_checks_image_store_filesystem(self) -> None:
        result = self.ship(docker_free_kb=2000000)
        self.assertNotEqual(result['code'], 0, result)
        self.assertEqual(result['events'], [], result)

    def test_checks_nested_content_and_snapshot_filesystems(self) -> None:
        for path in ('/var/lib/containerd/io.containerd.content.v1.content/ingest',
                     '/var/lib/containerd/io.containerd.content.v1.content/blobs',
                     '/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots'):
            with self.subTest(path=path):
                result = self.ship(docker_free_kb=100, low_path=path)
                self.assertNotEqual(result['code'], 0, result)
                self.assertEqual(result['events'], [])

    def test_unknown_layout_or_inode_shortage_blocks(self) -> None:
        for options in ({'block_size':'8192'}, {'docker_version':'30.0.0'}, {'inode_free':10}, {'bad_staging':True}, {'ambiguous_mount':True}, {'containerd_version':'2.2.20'}):
            with self.subTest(options=options):
                result = self.ship(**options)
                self.assertNotEqual(result['code'], 0, result)
                self.assertEqual(result['events'], [])

    def test_unpack_error_with_success_exit_is_failure(self) -> None:
        result = self.ship(unpack_error=True)
        self.assertNotEqual(result['code'], 0, result)
        self.assertFalse(result['stage_exists'])

    def test_preserves_preexisting_stage(self) -> None:
        result = self.ship(existing_stage=True)
        self.assertNotEqual(result['code'], 0, result)
        self.assertTrue(result['preexisting'])
        self.assertEqual(result['events'], [])

    def test_invalid_free_space_fails_closed(self) -> None:
        result = self.ship(invalid_df=True)
        self.assertNotEqual(result['code'], 0, result)
        self.assertEqual(result['events'], [])

    def test_install_failure_cleans_only_own_stage(self) -> None:
        result = self.ship(install_failure=True)
        self.assertNotEqual(result['code'], 0)
        self.assertFalse(result['stage_exists']); self.assertEqual(result['sibling'], 'untouched')

    def test_cancel_cleans_only_own_stage(self) -> None:
        result = self.ship(cancel=True)
        self.assertNotEqual(result['code'], 0)
        self.assertFalse(result['stage_exists']); self.assertEqual(result['sibling'], 'untouched')

    def test_workflow_serializes_artifact_writers(self) -> None:
        workflow = (ROOT/'.github/workflows/deploy.yml').read_text()
        image = workflow.split('  image:\n', 1)[1].split('  package:\n', 1)[0]
        self.assertIn('needs: [reclaim, package]', image)
        self.assertIn('max-parallel: 1', image)
        self.assertIn('cancel-in-progress: false', workflow)

if __name__ == '__main__': unittest.main()
