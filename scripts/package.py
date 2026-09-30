"""Package only tracked extension files; exclude local data and test dependencies."""
import json
import pathlib
import subprocess
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'extension/manifest.json').read_text())
output = root / 'output/store'
output.mkdir(parents=True, exist_ok=True)
target = output / f'amazon-assist-{manifest["version"]}.zip'
files = subprocess.check_output(['git', 'ls-files', '-z', '--', 'extension'], cwd=root).decode().split('\0')
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(filter(None, files)):
        path = pathlib.Path(name)
        if path.suffix not in {'.js', '.html', '.css', '.json', '.png'}:
            raise ValueError(f'Unexpected extension asset: {path}')
        archive.write(root / path, path.relative_to('extension'))
    archive.write(root / 'LICENSE', 'LICENSE')
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('manifest.json')) == manifest
    for name in manifest['icons'].values():
        assert name in archive.namelist(), f'Missing icon: {name}'
print(target)
