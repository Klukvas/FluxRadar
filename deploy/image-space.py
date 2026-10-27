"""Read docker-save archives without extracting; emit conservative KiB/inode budgets.

Supported Linux containerd overlayfs allocation is documented in image-space.md.
No credit is taken for layers already present on the destination.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import sys
import tarfile

BLOCK = 4096
LIMIT = 64 * 1024**3
INODE_LIMIT = 1000000

INDEX_TYPES = {'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'}
MANIFEST_TYPES = {'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'}
CONFIG_TYPES = {'application/vnd.oci.image.config.v1+json', 'application/vnd.docker.container.image.v1+json'}
LAYER_TYPES = {'application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip',
               'application/vnd.oci.image.layer.nondistributable.v1.tar', 'application/vnd.oci.image.layer.nondistributable.v1.tar+gzip',
               'application/vnd.docker.image.rootfs.diff.tar', 'application/vnd.docker.image.rootfs.diff.tar.gzip',
               'application/vnd.docker.image.rootfs.foreign.diff.tar.gzip'}
GRAPH_FIELDS = {'schemaVersion', 'mediaType', 'manifests', 'layers', 'config', 'annotations', 'subject', 'artifactType'}


def unambiguous_object(pairs: list[tuple[str, object]]) -> dict:
    # Go's typed JSON decoder folds field names; Python normally keeps them
    # distinct and silently replaces exact duplicates. Admit neither ambiguity.
    names = [name.casefold() for name, _ in pairs]
    if len(names) != len(set(names)):
        raise ValueError('ambiguous JSON object keys')
    return dict(pairs)


def canonical_fields(value: object, fields: set[str]) -> None:
    if not isinstance(value, dict):
        raise ValueError('invalid typed JSON object')
    spellings = {name.casefold(): name for name in fields}
    if any(name.casefold() in spellings and name != spellings[name.casefold()] for name in value):
        raise ValueError('noncanonical typed JSON field')


def graph_shape(value: dict, media_type: str) -> None:
    canonical_fields(value, GRAPH_FIELDS)
    if (type(value.get('schemaVersion')) is not int or value['schemaVersion'] != 2
            or ('manifests' in value) == ('layers' in value)
            or ('mediaType' in value and value['mediaType'] != media_type)):
        raise ValueError('unsupported OCI graph shape or media type')
    if media_type in INDEX_TYPES:
        if 'manifests' not in value or 'config' in value:
            raise ValueError('OCI index descriptor disagrees with graph shape')
    elif media_type in MANIFEST_TYPES:
        if 'layers' not in value or 'config' not in value:
            raise ValueError('OCI manifest descriptor disagrees with graph shape')
    else:
        raise ValueError('unsupported OCI graph media type')


def rounded(size: int) -> int:
    if size < 0 or size > LIMIT:
        raise ValueError('unsupported size')
    return ((size + BLOCK - 1) // BLOCK) * BLOCK


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('unsupported archive path')
    return str(path)


def layer_space(archive: tarfile.TarFile, name: str, allocation_limit: int, inode_limit: int) -> tuple[int, int]:
    source = archive.extractfile(name)
    if source is None:
        raise ValueError('missing layer')
    allocation = 0
    entries = 0
    regular: dict[str, int] = {}
    with source, tarfile.open(fileobj=source, mode='r:*') as layer:
        for member in layer:
            path = safe_name(member.name)
            if member.sparse is not None:
                raise ValueError('sparse layers require a reviewed allocation model')
            if member.isfile():
                size = member.size
                regular[path] = size
            elif member.islnk():
                target = safe_name(member.linkname)
                if target not in regular:
                    raise ValueError('unresolved or cross-layer hardlink')
                size = regular[target]
            elif member.isdir() or member.issym() or member.isdev() or member.isfifo():
                size = len(member.linkname.encode()) if member.issym() else 0
            else:
                raise ValueError('unsupported layer entry')
            # Charge parents per entry (even shared ones), one block of metadata
            # per inode, and xattrs separately. Overwrites receive no discount.
            count = max(1, len(PurePosixPath(path).parts))
            xattrs = sum(len(key.encode()) + len(value.encode()) for key, value in member.pax_headers.items())
            allocation += rounded(size) + count * BLOCK + rounded(xattrs)
            entries += count
            if allocation > allocation_limit or entries > inode_limit:
                raise ValueError('aggregate layer allocation/inode budget exceeded')
    return allocation, entries


def verify_oci_blob(archive: tarfile.TarFile, descriptor: dict,
                    members: dict[str, tarfile.TarInfo], verified: set[str], media_types: set[str]) -> str:
    if not isinstance(descriptor, dict):
        raise ValueError('invalid OCI blob descriptor')
    canonical_fields(descriptor, {'mediaType','digest','size','urls','annotations','data','platform','artifactType'})
    if descriptor.get('mediaType') not in media_types:
        raise ValueError('unsupported OCI blob media type')
    if 'data' in descriptor or 'urls' in descriptor:
        raise ValueError('embedded or remote OCI content is unsupported')
    digest = descriptor.get('digest')
    size = descriptor.get('size')
    if (not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest)
            or type(size) is not int or size < 0 or size > LIMIT):
        raise ValueError('invalid OCI blob digest or size')
    name = 'blobs/' + digest.replace(':', '/')
    member = members.get(name)
    if member is None or not member.isfile() or member.size != size:
        raise ValueError('OCI blob is missing or descriptor size differs from archive')
    if name not in verified:
        source = archive.extractfile(member)
        if source is None:
            raise ValueError('missing OCI blob bytes')
        hasher = hashlib.sha256()
        with source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                hasher.update(chunk)
        if hasher.hexdigest() != digest.removeprefix('sha256:'):
            raise ValueError('OCI blob SHA-256 differs from descriptor digest')
        verified.add(name)
    return name


def measure(path: Path) -> tuple[int, int, int, int]:
    with tarfile.open(path, mode='r:') as archive:
        if path.stat().st_size > LIMIT:
            raise ValueError('archive exceeds supported allocation budget')
        members = []
        apparent = 0
        for member in archive:
            members.append(member)
            apparent += rounded(member.size)
            if len(members) > INODE_LIMIT or apparent > LIMIT:
                raise ValueError('archive exceeds supported allocation/inode budget')
        names = [safe_name(member.name) for member in members]
        if len(names) != len(set(names)):
            raise ValueError('duplicate archive path')
        if any(not (member.isfile() or member.isdir()) for member in members):
            raise ValueError('unsupported outer archive entry')
        metadata: dict[str, object] = {}
        for member in members:
            if member.isfile() and member.size < 20 * 1024**2:
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError('missing metadata')
                with source:
                    try:
                        metadata[safe_name(member.name)] = json.load(source, object_pairs_hook=unambiguous_object)
                    except (json.JSONDecodeError, UnicodeError):
                        pass
        manifest = metadata.get('manifest.json')
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise ValueError('only single-image docker-save archives are supported')
        image = manifest[0]
        if not isinstance(image, dict) or not isinstance(image.get('Layers'), list):
            raise ValueError('invalid image manifest')
        canonical_fields(image, {'Config','Layers','RepoTags','LayerSources'})
        layers = image['Layers']
        if not layers or any(not isinstance(name, str) for name in layers):
            raise ValueError('invalid image layers')
        if image.get('Config') not in metadata:
            raise ValueError('missing image configuration')
        config = metadata[image['Config']]
        canonical_fields(config, {'created','author','architecture','os','os.version','os.features','variant','config','rootfs','history','container','container_config','docker_version'})
        rootfs = config.get('rootfs', {}) if isinstance(config, dict) else {}
        canonical_fields(rootfs, {'type','diff_ids'})
        diff_ids = rootfs.get('diff_ids') if isinstance(rootfs, dict) else None
        if (not isinstance(config, dict) or config.get('os') != 'linux'
                or not isinstance(rootfs, dict) or rootfs.get('type') != 'layers' or not isinstance(diff_ids, list)
                or len(diff_ids) != len(layers)
                or any(not isinstance(value, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', value)
                       for value in diff_ids)):
            raise ValueError('invalid image rootfs metadata')
        layer_names = {safe_name(name) for name in layers}
        if 'oci-layout' in metadata:
            members_by_name = dict(zip(names, members))
            verified: set[str] = set()
            def visit_oci(descriptor: dict, depth: int = 0) -> None:
                if depth > 4:
                    raise ValueError('invalid OCI descriptor graph')
                name = verify_oci_blob(archive, descriptor, members_by_name, verified, INDEX_TYPES | MANIFEST_TYPES)
                value = metadata.get(name)
                if not isinstance(value, dict):
                    raise ValueError('missing OCI descriptor metadata')
                graph_shape(value, descriptor['mediaType'])
                if descriptor['mediaType'] in INDEX_TYPES:
                    children = value['manifests']
                    if not isinstance(children, list) or len(children) != 1 or not isinstance(children[0], dict):
                        raise ValueError('only a single-image OCI graph is supported')
                    visit_oci(children[0], depth + 1)
                elif 'layers' not in value:
                    raise ValueError('invalid OCI manifest graph')
                else:
                    descriptors = value['layers']
                    if not isinstance(descriptors, list):
                        raise ValueError('invalid OCI manifest layers')
                    verify_oci_blob(archive, value.get('config'), members_by_name, verified, CONFIG_TYPES)
                    for layer_descriptor in descriptors:
                        verify_oci_blob(archive, layer_descriptor, members_by_name, verified, LAYER_TYPES)

            layout = metadata['oci-layout']
            canonical_fields(layout, {'imageLayoutVersion'})
            index = metadata.get('index.json')
            if isinstance(index, dict):
                graph_shape(index, index.get('mediaType', 'application/vnd.oci.image.index.v1+json'))
            if (not isinstance(layout, dict) or layout.get('imageLayoutVersion') != '1.0.0'
                    or not isinstance(index, dict) or not isinstance(index.get('manifests'), list)
                    or len(index['manifests']) != 1 or not isinstance(index['manifests'][0], dict)):
                raise ValueError('invalid single-image OCI index')
            visit_oci(index['manifests'][0])
        # OCI takes precedence over manifest.json. Require exactly the same
        # layer/config set; attestations, extra platforms and unknown blobs fail.
        for value in metadata.values():
            if isinstance(value, dict) and 'layers' in value:
                canonical_fields(value, GRAPH_FIELDS)
                descriptors = value['layers']
                config = value.get('config', {})
                if not isinstance(descriptors, list) or not isinstance(config, dict):
                    raise ValueError('invalid OCI manifest')
                oci_layers = ['blobs/' + item['digest'].replace(':', '/') for item in descriptors]
                oci_config = 'blobs/' + config['digest'].replace(':', '/')
                if oci_layers != layers or oci_config != image['Config']:
                    raise ValueError('OCI unpack coverage differs from Docker manifest')
        if any(member.isfile() and name not in metadata and name not in layer_names
               for member, name in zip(members, names)):
            raise ValueError('unaccounted binary archive content')
        unpack = 0
        inodes = len(members) * 2
        if inodes > INODE_LIMIT:
            raise ValueError('aggregate inode budget exceeded')
        for name in layers:
            allocation, count = layer_space(archive, name, LIMIT - unpack, INODE_LIMIT - inodes)
            unpack += allocation
            inodes += count
        # Include ALL regular outer entries, even unreferenced metadata. This
        # covers content ingestion, which renames its temporary file on commit.
        content = sum(rounded(member.size) + BLOCK for member in members if member.isfile())
        totals = (rounded(path.stat().st_size), content, unpack, inodes)
        if any(value <= 0 or value > LIMIT for value in totals):
            raise ValueError('invalid or excessive image budget')
        return totals[0] // 1024, totals[1] // 1024, totals[2] // 1024, totals[3]


if __name__ == '__main__':
    try:
        print(*measure(Path(sys.argv[1])))
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        sys.exit(f'ERROR: cannot safely budget Docker archive: {error}')
