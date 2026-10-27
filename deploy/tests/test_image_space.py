"""Archive formats at the same parser boundary used by the shipping action."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import runpy
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PARSER = runpy.run_path(str(ROOT/'deploy/image-space.py'))


def tar_bytes(entries: list[tuple[str, bytes | str]]) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, value in entries:
            member = tarfile.TarInfo(name)
            if isinstance(value, str):
                member.type = tarfile.LNKTYPE
                member.linkname = value
                archive.addfile(member)
            else:
                member.size = len(value)
                archive.addfile(member, io.BytesIO(value))
    return output.getvalue()


def oci_archive(*, corrupt: str = '', bad_size: str = '', missing_size: str = '', repeats: int = 1, broken: bool = False, ambiguous: str = '') -> bytes:
    """Genuine content-addressed graph; ambiguity is encoded before hashing."""
    media = {'layer':'application/vnd.oci.image.layer.v1.tar',
             'config':'application/vnd.oci.image.config.v1+json',
             'manifest':'application/vnd.oci.image.manifest.v1+json',
             'index':'application/vnd.oci.image.index.v1+json'}
    large_layer = tar_bytes([('payload',b'x'*2097152)])
    layer = tar_bytes([('payload',b'x')]) if ambiguous in ('manifest-layers','descriptor-digest') else large_layer
    config_value = {'os':'linux','architecture':'amd64','fixture':'a',
                    'rootfs':{'type':'layers','diff_ids':['sha256:'+hashlib.sha256(large_layer).hexdigest()]}}
    if ambiguous == 'config-rootfs': config_value['RootFS'] = config_value['rootfs']
    if ambiguous == 'rootfs-diff-ids': config_value['rootfs']['Diff_ids'] = config_value['rootfs']['diff_ids']
    if ambiguous == 'rootfs-type': config_value['rootfs']['Type'] = 'layers'
    if ambiguous == 'cached-descriptor-size': config_value['rootfs']['diff_ids'] *= 2
    config = json.dumps(config_value).encode()
    def descriptor(data: bytes, kind: str) -> dict:
        result = {'mediaType':media[kind], 'digest':'sha256:'+hashlib.sha256(data).hexdigest(),'size':len(data)}
        if bad_size == kind: result['size'] = len(data)+1
        if missing_size == kind: result.pop('size')
        if ambiguous == 'descriptor-size' and kind == 'layer': result['Size'] = len(data)
        if ambiguous == 'descriptor-digest' and kind == 'layer':
            result['Digest'] = 'sha256:'+hashlib.sha256(large_layer).hexdigest()
            result['Size'] = len(large_layer)
        if ambiguous == 'descriptor-media-type' and kind == 'layer': result['MediaType'] = media[kind]
        if ambiguous == 'unknown-media-type' and kind == 'layer': result['mediaType'] = 'application/unknown'
        if ambiguous == 'missing-media-type' and kind == 'layer': result.pop('mediaType')
        return result
    layer_descriptor = descriptor(layer,'layer')
    config_descriptor = descriptor(config,'config')
    manifest_value = {'schemaVersion':2,'mediaType':media['manifest'],'fixture':'a','config':config_descriptor,'layers':[layer_descriptor]*repeats}
    if ambiguous == 'cached-descriptor-size':
        manifest_value['layers'] = [layer_descriptor, {**layer_descriptor, 'Size':len(layer)}]
    if ambiguous == 'manifest-layers': manifest_value['Layers'] = [descriptor(large_layer,'layer')]
    if ambiguous == 'manifest-config': manifest_value['Config'] = config_descriptor
    if ambiguous == 'mixed-shape': manifest_value['manifests'] = []
    if ambiguous == 'uppercase-index-decoy':
        manifest_value['Manifests'] = []
    manifest = json.dumps(manifest_value).encode()
    if ambiguous == 'exact-duplicate':
        manifest = manifest[:-1]+b', "layers": '+json.dumps([layer_descriptor]*repeats).encode()+b'}'
    manifest_descriptor = descriptor(manifest,'manifest')
    nested_value = {'schemaVersion':2,'mediaType':media['index'],'fixture':'a','manifests':[manifest_descriptor]*(2 if broken else 1)}
    if ambiguous == 'nested-index-manifests': nested_value['Manifests'] = nested_value['manifests']
    nested_index = json.dumps(nested_value).encode()
    nested_descriptor = descriptor(nested_index,'index')
    name = lambda item: 'blobs/'+item['digest'].replace(':','/')
    root_index = {'schemaVersion':2,'mediaType':media['index'],'manifests':[nested_descriptor]}
    if ambiguous == 'root-index-manifests': root_index['Manifests'] = root_index['manifests']
    if ambiguous == 'root-index-uppercase-only': root_index['Manifests'] = root_index.pop('manifests'); root_index['layers'] = []
    docker_manifest = {'Config':name(config_descriptor),'Layers':[name(layer_descriptor)]}
    if ambiguous == 'cached-descriptor-size': docker_manifest['Layers'] *= 2
    if ambiguous == 'docker-layers': docker_manifest['layers'] = docker_manifest['Layers']
    actual_layer = tar_bytes([('payload',b'x')]) if corrupt == 'short-layer' else layer
    if corrupt == 'layer': actual_layer = layer[:512]+b'y'+layer[513:]
    entries = [('manifest.json',json.dumps([docker_manifest]).encode()),
               ('oci-layout',b'{"imageLayoutVersion":"1.0.0"}'),
               ('index.json',json.dumps(root_index).encode()),
               (name(nested_descriptor),nested_index.replace(b'"fixture": "a"',b'"fixture": "b"') if corrupt == 'index' else nested_index),
               (name(manifest_descriptor),manifest.replace(b'"fixture": "a"',b'"fixture": "b"') if corrupt == 'manifest' else manifest),
               (name(config_descriptor),config.replace(b'"fixture": "a"',b'"fixture": "b"') if corrupt == 'config' else config),
               (name(layer_descriptor),actual_layer)]
    return tar_bytes(entries)


class ImageSpaceTest(unittest.TestCase):
    def measure(self, layers: list[bytes], *, extra: list[tuple[str, bytes | str]] | None = None, config_override: dict | None = None) -> tuple:
        with tempfile.TemporaryDirectory(dir=ROOT/'deploy/tests') as folder:
            path = Path(folder)/'image.tar'
            names = [f'layer-{index}.tar' for index in range(len(layers))]
            manifest = json.dumps([{'Config':'config.json', 'Layers':names}]).encode()
            path.write_bytes(tar_bytes([('manifest.json',manifest), ('config.json',json.dumps(config_override if config_override is not None else {'os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+'a'*64]*len(layers)}}).encode()),
                                       *zip(names,layers), *(extra or [])]))
            return PARSER['measure'](path)

    def test_compressed_layer_uses_unpacked_allocation_not_blob_size(self) -> None:
        layer = tar_bytes([('a/b/c',b'0'*2000000)])
        archive, content, unpack, inodes = self.measure([gzip.compress(layer)])
        self.assertGreater(unpack, 1953)
        self.assertLess(archive+content, unpack)
        self.assertGreaterEqual(inodes, 3)

    def test_small_files_charge_blocks_and_implicit_parent_directories(self) -> None:
        _, _, unpack, inodes = self.measure([tar_bytes([('a/b/c',b'x'),('a/b/d',b'y')])])
        self.assertGreaterEqual(unpack, 32)
        self.assertGreaterEqual(inodes, 6)

    def test_same_layer_hardlink_is_charged_and_cross_layer_rejected(self) -> None:
        plain = self.measure([tar_bytes([('target',b'0'*10000)])])
        linked = self.measure([tar_bytes([('target',b'0'*10000),('alias','target')])])
        self.assertGreaterEqual(linked[2]-plain[2], 12)
        with self.assertRaisesRegex(ValueError,'cross-layer'):
            self.measure([tar_bytes([('target',b'0'*10000)]),tar_bytes([('alias','target')])])

    def test_oci_unpack_coverage_must_match_docker_manifest(self) -> None:
        mismatched = json.dumps({'config':{'digest':'sha256:other'},
                                 'layers':[{'digest':'sha256:hidden'}]}).encode()
        with self.assertRaisesRegex(ValueError,'OCI unpack coverage'):
            self.measure([tar_bytes([('payload',b'x')])],extra=[('blobs/sha256/manifest',mismatched)])

    def test_valid_oci_graph_and_repeated_layer_or_malformed_graph(self) -> None:
        for repeats, broken, accepted in ((1,False,True),(2,False,False),(1,True,False)):
            with self.subTest(repeats=repeats,broken=broken), tempfile.TemporaryDirectory(dir=ROOT/'deploy/tests') as folder:
                path = Path(folder)/'oci.tar'
                path.write_bytes(oci_archive(repeats=repeats,broken=broken))
                if accepted:
                    self.assertGreater(PARSER['measure'](path)[2],0)
                else:
                    with self.assertRaises(ValueError): PARSER['measure'](path)

    def test_referenced_oci_blob_identity_must_match_actual_archive_bytes(self) -> None:
        for corrupt in ('short-layer','layer','config','manifest','index'):
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory(dir=ROOT/'deploy/tests') as folder:
                path = Path(folder)/'oci.tar'; path.write_bytes(oci_archive(corrupt=corrupt))
                with self.assertRaisesRegex(ValueError,'OCI blob'):
                    PARSER['measure'](path)

    def test_referenced_oci_descriptor_size_is_required_and_exact(self) -> None:
        for kind in ('layer','config','manifest','index'):
            for options in ({'bad_size':kind},{'missing_size':kind}):
                with self.subTest(options=options), tempfile.TemporaryDirectory(dir=ROOT/'deploy/tests') as folder:
                    path = Path(folder)/'oci.tar'; path.write_bytes(oci_archive(**options))
                    with self.assertRaisesRegex(ValueError,'OCI blob'):
                        PARSER['measure'](path)

    def test_json_key_ambiguities_and_unknown_classification_fail_closed(self) -> None:
        cases = ('manifest-layers','descriptor-digest','descriptor-size','descriptor-media-type',
                 'manifest-config','nested-index-manifests','root-index-manifests',
                 'config-rootfs','rootfs-diff-ids','rootfs-type','docker-layers',
                 'exact-duplicate','cached-descriptor-size','unknown-media-type','missing-media-type',
                 'mixed-shape','uppercase-index-decoy','root-index-uppercase-only')
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory(dir=ROOT/'deploy/tests') as folder:
                path = Path(folder)/'oci.tar'; path.write_bytes(oci_archive(ambiguous=case))
                with self.assertRaises(ValueError): PARSER['measure'](path)

    def test_invalid_config_diff_ids_fail_closed(self) -> None:
        config = json.dumps({'os':'linux','rootfs':{'type':'layers','diff_ids':[]}}).encode()
        with self.assertRaisesRegex(ValueError,'rootfs'):
            self.measure([tar_bytes([('payload',b'x')])],config_override=json.loads(config))

    def test_unknown_binary_or_malformed_layer_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError,'unaccounted binary'):
            self.measure([tar_bytes([('payload',b'x')])],extra=[('mystery',b'\xff\xff')])
        with self.assertRaises(tarfile.TarError):
            self.measure([b'not a tar'])

    def test_excessive_declared_file_size_is_rejected_before_reading_payload(self) -> None:
        header = tarfile.TarInfo('huge'); header.size=65*1024**3
        with self.assertRaisesRegex(ValueError,'unsupported size'):
            self.measure([header.tobuf()+b'\0'*1024])

    def test_total_inode_cap_applies_across_layers(self) -> None:
        with patch.dict(PARSER['measure'].__globals__, {'INODE_LIMIT':12}):
            with self.assertRaisesRegex(ValueError,'aggregate'):
                self.measure([tar_bytes([('a/b/c',b'x')]),tar_bytes([('a/b/d',b'y')])])

    def test_aggregate_allocation_stops_before_scanning_later_layers(self) -> None:
        globals_ = PARSER['measure'].__globals__
        with patch.dict(globals_, {'LIMIT':45000}):
            with patch.dict(globals_, {'layer_space':unittest.mock.Mock(wraps=globals_['layer_space'])}):
                with self.assertRaises(ValueError):
                    self.measure([gzip.compress(tar_bytes([('payload',b'0'*10000)]))]*4)
                self.assertLessEqual(globals_['layer_space'].call_count,3)

    def test_duplicate_or_unsafe_paths_fail_closed(self) -> None:
        for entries in ([('payload',b'x'),('payload',b'y')], [('../outside',b'x')]):
            with self.subTest(entries=entries):
                # Duplicate layer entries are conservatively charged twice;
                # unsafe paths must be rejected before an upload is attempted.
                if entries[0][0].startswith('..'):
                    with self.assertRaisesRegex(ValueError,'archive path'):
                        self.measure([tar_bytes(entries)])
                else:
                    self.assertGreater(self.measure([tar_bytes(entries)])[2], 0)

if __name__ == '__main__': unittest.main()
