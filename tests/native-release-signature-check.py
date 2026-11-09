"""Authenticate release metadata using an ephemeral public test certificate only."""
from pathlib import Path
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
harness=r'''
package in.navrang.gate;
import java.util.*;import java.nio.charset.StandardCharsets;
public final class ReleaseSignatureCheck {
 static int checks;static void check(boolean value,String reason){checks++;if(!value)throw new AssertionError(reason);}
 public static void main(String[] args)throws Exception {
  String name="0.9.0",url=UpdatePolicy.ROOT+"downloads/Navrang-Gate-0.9.0.apk",hash="a".repeat(64);
  byte[] payload=UpdatePolicy.manifestBytes(19,name,url,20000000,hash),signature=ReleaseSignatureFixture.sign(payload),certificate=ReleaseSignatureFixture.certificate();
  check(new String(payload,StandardCharsets.UTF_8).startsWith("navrang-release-v1\nin.navrang.gate\n19\n"),"domain-separated stable payload");
  check(UpdatePolicy.authentic(certificate,19,name,url,20000000,hash,signature),"matching installed certificate authenticates metadata");
  check(!UpdatePolicy.authentic(certificate,20,name,url,20000000,hash,signature),"version tampering rejected");
  check(!UpdatePolicy.authentic(certificate,19,name,url,20000001,hash,signature),"size tampering rejected");
  check(!UpdatePolicy.authentic(certificate,19,name,url,20000000,"b".repeat(64),signature),"digest tampering rejected");
  signature[0]^=1;check(!UpdatePolicy.authentic(certificate,19,name,url,20000000,hash,signature),"signature tampering rejected");
  check(!UpdatePolicy.authentic(new byte[]{1},19,name,url,20000000,hash,signature),"malformed certificate rejected");
  check(!UpdatePolicy.authentic(certificate,19,name,url,20000000,hash,new byte[0]),"missing signature rejected");
  check(!UpdatePolicy.authentic(certificate,19,name,"https://other.invalid/app.apk",20000000,hash,signature),"unapproved update host rejected");
  check(!UpdatePolicy.authentic(certificate,19,name,url,30000000,hash,signature),"signature does not bypass package size policy");
  java.util.Set<String> available=new java.util.HashSet<>(java.util.Arrays.asList(UpdatePolicy.ABIS));
  check("arm64-v8a".equals(UpdatePolicy.preferredAbi(new String[]{"arm64-v8a","armeabi-v7a"},available)),"device preference order preserved");
  check(UpdatePolicy.preferredAbi(new String[]{"future-abi"},available)==null,"unknown ABI uses universal");
  check(UpdatePolicy.preferredAbi(null,available)==null,"missing ABI data uses universal");
  for(String abi:UpdatePolicy.ABIS){
   String variant=UpdatePolicy.apkUrl(name,abi);UpdatePolicy.validateArtifact(19,name,variant,20000000,hash,abi);
   byte[] proof=ReleaseSignatureFixture.sign(UpdatePolicy.manifestBytes(19,name,variant,20000000,hash));
   check(UpdatePolicy.authentic(certificate,19,name,variant,20000000,hash,proof),"v1 proof authenticates "+abi);
   check(!UpdatePolicy.authentic(certificate,19,name,url,20000000,hash,proof),"ABI signature cannot become a universal signature");
   try{UpdatePolicy.validateArtifact(19,name,variant,20000000,hash,null);throw new AssertionError("ABI relabeling accepted");}catch(IllegalArgumentException expected){checks++;}
  }
  try{UpdatePolicy.validateArtifact(19,name,UpdatePolicy.apkUrl(name,"x86"),20000000,hash,"x86_64");throw new AssertionError("Cross-ABI label accepted");}catch(IllegalArgumentException expected){checks++;}
  check(!UpdatePolicy.authentic(certificate,19,name,url+"?redirect=1",20000000,hash,signature),"URL query rejected");
  java.nio.file.Path publicCert=java.nio.file.Files.createTempFile("navrang-public-fixture-",".der");
  try{
   java.nio.file.Files.write(publicCert,certificate);
   byte[] proof=ReleaseSignatureFixture.sign(UpdatePolicy.manifestBytes(19,name,url,20000000,hash));
   String[] cli={publicCert.toString(),"19",name,url,"20000000",hash,Base64.getEncoder().encodeToString(proof),"universal"};
   VerifyUpdateMetadata.main(cli);checks++;
   cli[6]="";try{VerifyUpdateMetadata.main(cli);throw new AssertionError("Verifier accepted missing proof");}catch(IllegalArgumentException expected){checks++;}
  }finally{java.nio.file.Files.deleteIfExists(publicCert);}
  System.out.println("Signed release metadata: "+checks+" checks passed (ephemeral fixture; no APK signing key).");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-release-signature-') as temp:
    work=Path(temp); source=work/'ReleaseSignatureCheck.java'; source.write_text(harness,encoding='utf-8')
    subprocess.run(['javac','--release','17','-Xlint:all','-Werror','-d',str(work),str(root/'app/java/in/navrang/gate/UpdatePolicy.java'),str(root/'tests/ReleaseSignatureFixture.java'),str(root/'tools/VerifyUpdateMetadata.java'),str(source)],check=True)
    subprocess.run(['java','-cp',str(work),'in.navrang.gate.ReleaseSignatureCheck'],check=True)
