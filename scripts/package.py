"""Build a reproducible install ZIP from tracked assets, or verify a release ZIP."""
import argparse
import hashlib
import json
import pathlib
import posixpath
import re
import subprocess
import zipfile
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUFFIXES = {'.js', '.html', '.css', '.json', '.png'}


class AssetLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.links.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.links.append(attrs['href'])


def verify(target, tag=None):
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip() is not None:
            raise ValueError('Duplicate or corrupt ZIP entries')
        for name in names:
            path = pathlib.PurePosixPath(name)
            if '\\' in name or path.is_absolute() or '..' in path.parts or name != str(path):
                raise ValueError(f'Unsafe ZIP path: {name}')
            if name != 'LICENSE' and path.suffix not in SUFFIXES:
                raise ValueError(f'Unexpected extension asset: {name}')
            if path.parts[0] in {'tmp', 'tests', 'node_modules', 'output', '.git'}:
                raise ValueError(f'Unexpected extension directory: {name}')
            if name.endswith('.json') and name != 'manifest.json':
                raise ValueError(f'Unexpected JSON asset: {name}')

        def require(name, base=''):
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(base), name))
            if resolved not in names:
                raise ValueError(f'Missing asset: {resolved} (from {base or "manifest"})')

        require('manifest.json')
        require('app.html')
        require('LICENSE')
        manifest = json.loads(archive.read('manifest.json'))
        version = manifest['version']
        if manifest['manifest_version'] != 3:
            raise ValueError('Expected Manifest V3')
        if tag is not None and tag != f'v{version}':
            raise ValueError(f'Tag {tag} does not match manifest v{version}')
        require(manifest['background']['service_worker'])
        for icon in manifest['icons'].values():
            require(icon)
        for content in manifest['content_scripts']:
            for name in content.get('js', []) + content.get('css', []):
                require(name)
        for name in names:
            if name.endswith('.html'):
                parser = AssetLinks()
                parser.feed(archive.read(name).decode())
                for link in parser.links:
                    if ':' in link or link.startswith('/'):
                        raise ValueError(f'Non-local app asset: {link}')
                    require(link, name)
            if name.endswith('.js'):
                text = archive.read(name).decode()
                for link in re.findall(r"\bfrom\s*['\"]([^'\"]+)['\"]", text):
                    if not link.startswith('.'):
                        raise ValueError(f'Non-local module import: {link}')
                    require(link, name)
        if f'v{version}' not in archive.read('app.html').decode():
            raise ValueError('App version does not match manifest')
        if not re.search(rf"\bVERSION\s*=\s*['\"]{re.escape(version)}['\"]", archive.read('diagnostics.js').decode()):
            raise ValueError('Diagnostic version does not match manifest')
        return version


def package(tag=None):
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    output = ROOT / 'output/store'
    output.mkdir(parents=True, exist_ok=True)
    target = output / f'amazon-assist-{manifest["version"]}.zip'
    tracked = subprocess.check_output(['git', 'ls-files', '-z', '--', 'extension'], cwd=ROOT).decode().split('\0')
    assets = {str(pathlib.PurePosixPath(name).relative_to('extension')): ROOT / name for name in tracked if name}
    assets['LICENSE'] = ROOT / 'LICENSE'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, path in sorted(assets.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compresslevel=9)
    verify(target, tag)
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(f'{checksum}  {target.name}\n')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=pathlib.Path, help='Verify an existing ZIP instead of building')
    parser.add_argument('--tag', help='Require a matching release tag, for example v1.1.4')
    args = parser.parse_args()
    if args.verify:
        print(f'Valid package v{verify(args.verify, args.tag)}: {args.verify}')
    else:
        print(package(args.tag))
