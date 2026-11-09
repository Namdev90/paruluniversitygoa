"""Exercise the actual relay classes with synthetic ports; no TLS, audio or credentials."""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / 'native-app/src/main/java/in/navrang/gate'
PRODUCTION = [
    'VoiceAuthority.java', 'VoiceMediaTransport.java', 'WebSocketAudioRelayTransport.java',
    'RelayV1Protocol.java', 'RelayV1Driver.java', 'RelayClock.java', 'RelayNativeCredential.java',
    'RelayMediaOwner.java', 'NativeRelayClockProbe.java', 'RelayWebSocketWire.java', 'RelayOpusPacket.java', 'NativeRelaySocket.java', 'RelayPlaybackFence.java',
]
TESTS = [
    'WebSocketAudioRelayTransportTest', 'RelayV1ProtocolTest', 'RelayV1DriverTest',
    'RelayMediaOwnerTest', 'RelayPreparedDriverTest', 'NativeRelayClockProbeTest', 'AsyncRelayTest', 'NativeRelayWireTest', 'RelayClockTest', 'RelayNativeCredentialTest', 'RelayPlaybackFenceTest',
]

if not shutil.which('javac') or not shutil.which('java'):
    raise SystemExit('Full JDK required for relay verification.')
with tempfile.TemporaryDirectory(prefix='navrang-relay-check-') as directory:
    inputs = [str(JAVA / name) for name in PRODUCTION]
    inputs += [str(ROOT / 'tests/relay' / (name + '.java')) for name in TESTS]
    subprocess.run(['javac', '--release', '17', '-Xlint:all', '-Werror', '-d', directory, *inputs], check=True)
    for name in TESTS:
        subprocess.run(['java', '-ea', '-cp', directory, 'in.navrang.gate.' + name], check=True)
print('PASS: actual native relay classes, both ported suites, async/wire, clock and credential ownership.')
