"""Use the retained original identity without password arguments/files or key export."""
import ast
import base64
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
EXPECTED_CERTIFICATE='0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce'

class SigningUnavailable(RuntimeError):
    pass

class _MemoryConfig:
    def __init__(self,value):self._value=bytearray(value.encode('utf-8'))
    def __repr__(self):return '<Original signing configuration: private>'
    def stdin(self,count=1):return (bytes(self._value)+b'\n')*count if self._value else b''
    def close(self):
        for index in range(len(self._value)):self._value[index]=0
        self._value.clear()
    def __enter__(self):return self
    def __exit__(self,*unused):self.close()

def _constant(node,constants):
    if isinstance(node,ast.Constant) and isinstance(node.value,str):return node.value
    if isinstance(node,ast.Name) and isinstance(constants.get(node.id),str):return constants[node.id]
    if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Add):return _constant(node.left,constants)+_constant(node.right,constants)
    raise ValueError('Nonconstant signing configuration')

def recovery_config(provenance):
    """Parse only original tools/build.py constants. Never execute archive code."""
    try:
        note=json.loads(Path(provenance).read_text(encoding='utf-8-sig'))
        if note.get('certificate_sha256')!=EXPECTED_CERTIFICATE or note.get('private_key_usable') is not True or note.get('original_key_bytes_preserved') is not True:
            raise ValueError('Unverified provenance')
        archive=Path(note['local_original_archive'])
        if not archive.is_absolute() or not archive.is_file():raise ValueError('Original archive unavailable')
        with zipfile.ZipFile(archive) as source:
            candidates=[entry for entry in source.infolist() if entry.filename.replace('\\','/').endswith('/tools/build.py') or entry.filename=='tools/build.py']
            if len(candidates)!=1 or candidates[0].file_size>512*1024:raise ValueError('Original build configuration ambiguous')
            tree=ast.parse(source.read(candidates[0]).decode('utf-8-sig'))
        constants={}
        assignments=[node for node in ast.walk(tree) if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)]
        for _ in range(8):
            for node in assignments:
                try:
                    value=_constant(node.value,constants);name=node.targets[0].id
                    constants[name]=None if name in constants and constants[name]!=value else value
                except ValueError:continue
        passwords=set()
        for node in ast.walk(tree):
            values=node.elts if isinstance(node,(ast.List,ast.Tuple)) else node.args if isinstance(node,ast.Call) else []
            for index,value in enumerate(values[:-1]):
                try:flag=_constant(value,constants)
                except ValueError:continue
                if flag not in ('-storepass','-keypass','--ks-pass','--key-pass'):continue
                password=_constant(values[index+1],constants)
                if flag.startswith('--'):
                    if not password.startswith('pass:'):raise ValueError('External password reference is not an original constant')
                    password=password[5:]
                if not password or len(password)>1024 or any(char in password for char in '\r\n\0'):raise ValueError('Invalid configuration')
                passwords.add(password)
        if len(passwords)!=1:raise ValueError('Ambiguous signing configuration')
        return _MemoryConfig(passwords.pop())
    except Exception:
        # Do not include original source, AST values, passwords or private paths.
        raise SigningUnavailable('Original signing configuration could not be verified privately.') from None

class OriginalSigner:
    """Short-lived private process-memory access. All child password inputs use stdin."""
    def __init__(self,key):
        self.key=Path(key);self.config=None;self.temp=None;self.alias=None
    def __repr__(self):return '<Original signer: private>'
    def __enter__(self):
        try:
            if not self.key.is_file() or self.key.suffix.lower() not in ('.p12','.pfx'):raise SigningUnavailable('Retained original PKCS#12 is required.')
            self.config=recovery_config(self.key.parent/'RECOVERY-PROVENANCE.json')
            (ROOT/'.build').mkdir(exist_ok=True)
            self.temp=tempfile.TemporaryDirectory(prefix='original-signing-tool-',dir=ROOT/'.build')
            compiled=subprocess.run(['javac','--release','17','-d',self.temp.name,str(ROOT/'app/java/in/navrang/gate/UpdatePolicy.java'),str(ROOT/'tools/OriginalSignerTool.java')],capture_output=True)
            if compiled.returncode:raise SigningUnavailable('Private signing helper could not compile.')
            alias=self._call('verify').decode('utf-8').strip()
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',alias):raise SigningUnavailable('Original private-key entry could not be verified.')
            self.alias=alias;return self
        except Exception:
            self.__exit__();raise SigningUnavailable('Retained signing identity could not be verified privately.') from None
    def _call(self,*public_arguments):
        result=subprocess.run(['java','-cp',self.temp.name,'OriginalSignerTool',str(self.key),*map(str,public_arguments)],input=self.config.stdin(),capture_output=True)
        if result.returncode:raise SigningUnavailable('Original signing operation failed; private diagnostics were withheld.')
        return result.stdout
    def sign_metadata(self,metadata):
        proof=self._call('metadata',metadata['versionCode'],metadata['versionName'],metadata['apkUrl'],metadata['size'],metadata['sha256']).decode('ascii').strip()
        if not 32<=len(base64.b64decode(proof,validate=True))<=2048:raise SigningUnavailable('Metadata signature could not be verified.')
        return {**metadata,'signature':proof}
    def sign_apk(self,apksigner_jar,aligned,candidate):
        result=subprocess.run(['java','-jar',str(apksigner_jar),'sign','--ks',str(self.key),'--ks-pass','stdin','--key-pass','stdin',
            '--ks-key-alias',self.alias,'--v4-signing-enabled','false','--out',str(candidate),str(aligned)],input=self.config.stdin(2),capture_output=True)
        if result.returncode:raise SigningUnavailable('APK signing failed; private diagnostics were withheld.')
    def __exit__(self,*unused):
        if self.config is not None:self.config.close();self.config=None
        if self.temp is not None:self.temp.cleanup();self.temp=None
        self.alias=None
