"""Build locally with the installed Android build tools and a per-user signing key."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parent
bt, platform = map(Path, sys.argv[1:3])
jar = platform / "android.jar"
jdk = Path(os.environ["JAVA_HOME"]) / "bin"
key = Path.home() / ".android" / "quizpocket-debug.p12"
output = root / "QuizPocket.apk"

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)

with tempfile.TemporaryDirectory(dir=root) as tmp:
    stage = Path(tmp)
    classes = stage / "classes"
    classes.mkdir()
    raw = stage / "unsigned.apk"
    run(bt/"aapt.exe", "package", "-f", "-M", root/"AndroidManifest.xml", "-S", root/"res", "-A", root/"assets", "-I", jar, "-F", raw)
    run(jdk/"javac.exe", "--release", "8", "-encoding", "UTF-8", "-classpath", jar, "-d", classes, *root.glob("src/**/*.java"))
    compiled = stage/"classes.jar"
    run(jdk/"jar.exe", "cf", compiled, "-C", classes, ".")
    run(jdk/"java.exe", "-cp", bt/"lib/d8.jar", "com.android.tools.r8.D8", "--min-api", "26", "--lib", jar, "--output", stage, compiled)
    with zipfile.ZipFile(raw, "a") as apk:
        apk.write(stage/"classes.dex", "classes.dex")
    aligned = stage/"aligned.apk"
    run(bt/"zipalign.exe", "-f", "4", raw, aligned)
    if not key.exists():
        key.parent.mkdir(exist_ok=True)
        run(jdk/"keytool.exe", "-genkeypair", "-keystore", key, "-storepass", "android", "-keypass", "android", "-alias", "quizpocket", "-dname", "CN=QuizPocket Local Build", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000")
    signer = [jdk/"java.exe", "-jar", bt/"lib/apksigner.jar"]
    signed = stage/"signed.apk"
    run(*signer, "sign", "--ks", key, "--ks-pass", "pass:android", "--out", signed, aligned)
    run(*signer, "verify", signed)
    signed.replace(output)
print(output)
