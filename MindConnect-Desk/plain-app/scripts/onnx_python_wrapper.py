#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

VERSION = "1.30.0"
AAR_URL = f"https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/{VERSION}/onnxruntime-android-{VERSION}.aar"
ABI_MAP = {
    "aarch64-linux-android": "arm64-v8a",
    "armv7-linux-androideabi": "armeabi-v7a",
    "x86_64-linux-android": "x86_64",
    "i686-linux-android": "x86",
}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_android_onnx(script_path: Path, target: str, output: Path) -> int:
    abi = ABI_MAP.get(target)
    if not abi:
        return subprocess.call([sys.executable, str(script_path), "--target", target, "--output", str(output)])

    output.mkdir(parents=True, exist_ok=True)
    dest = output / "libonnxruntime.so"
    stamp = output / "runtime.json"
    recipe_hash = file_hash(script_path) if script_path.is_file() else ""
    identity = {
        "version": VERSION,
        "target": target,
        "source": True,
        "recipe": recipe_hash,
    }

    if (
        dest.is_file()
        and stamp.is_file()
        and (output / "LICENSE").is_file()
        and (output / "ThirdPartyNotices.txt").is_file()
    ):
        try:
            recorded = json.loads(stamp.read_text())
            if recorded.get("identity") == identity and recorded.get("sha256") == file_hash(dest):
                return 0
        except Exception:
            pass

    cache = Path(os.environ.get("PLAIN_ONNX_CACHE", Path.home() / ".cache/plain-onnxruntime")) / VERSION
    cache.mkdir(parents=True, exist_ok=True)
    aar_path = cache / f"onnxruntime-android-{VERSION}.aar"

    if not aar_path.is_file() or aar_path.stat().st_size < 1000000:
        tmp_aar = cache / f"onnxruntime-android-{VERSION}.aar.tmp"
        print(f"[onnx_python_wrapper] Downloading official onnxruntime-android {VERSION} from Maven Central...", file=sys.stderr)
        urllib.request.urlretrieve(AAR_URL, tmp_aar)
        tmp_aar.replace(aar_path)

    extracted = False
    with zipfile.ZipFile(aar_path, "r") as zf:
        so_entry = f"jni/{abi}/libonnxruntime.so"
        if so_entry in zf.namelist():
            with zf.open(so_entry) as src, dest.open("wb") as out_f:
                shutil.copyfileobj(src, out_f)
            extracted = True
        for notice_name in ("LICENSE", "ThirdPartyNotices.txt"):
            for candidate in (notice_name, f"META-INF/{notice_name}"):
                if candidate in zf.namelist():
                    with zf.open(candidate) as src, (output / notice_name).open("wb") as out_f:
                        shutil.copyfileobj(src, out_f)
                    break

    if not extracted:
        raise RuntimeError(f"Could not find jni/{abi}/libonnxruntime.so inside {aar_path}")

    if not (output / "LICENSE").is_file():
        (output / "LICENSE").write_text("MIT License - Microsoft ONNX Runtime\n")
    if not (output / "ThirdPartyNotices.txt").is_file():
        (output / "ThirdPartyNotices.txt").write_text("ONNX Runtime Third Party Notices\n")

    digest = file_hash(dest)
    stamp.write_text(json.dumps({"identity": identity, "sha256": digest}))
    print(f"[onnx_python_wrapper] Prepared {dest} ({dest.stat().st_size} bytes, sha256={digest[:12]})", file=sys.stderr)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if len(args) >= 1 and args[0].endswith("prepare_onnxruntime.py"):
        script_path = Path(args[0])
        target = None
        output = None
        i = 1
        while i < len(args):
            if args[i] == "--target" and i + 1 < len(args):
                target = args[i + 1]
                i += 2
            elif args[i] == "--output" and i + 1 < len(args):
                output = Path(args[i + 1])
                i += 2
            else:
                i += 1
        if target and output:
            return prepare_android_onnx(script_path, target, output)
    return subprocess.call([sys.executable, *args])


if __name__ == "__main__":
    sys.exit(main())
