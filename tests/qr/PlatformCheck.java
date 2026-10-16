import in.navrang.gate.AtomicCommit;
import in.navrang.gate.WebViewSupport;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
public final class PlatformCheck {
 static final byte[] GOOD="previous good state".getBytes(StandardCharsets.UTF_8),NEXT="new admission state".getBytes(StandardCharsets.UTF_8);
 static class MemoryStore implements AtomicCommit.Store {
  byte[] saved=GOOD;boolean synced=false,drop=false,syncFails=false,readFails=false,truncated=false,failed=false;
  ByteArrayOutputStream output;
  public OutputStream start(){output=new ByteArrayOutputStream();return output;}
  public void sync(OutputStream out)throws IOException{if(syncFails)throw new IOException("disk full");synced=true;}
  public void finish(OutputStream out){if(!synced||drop)return;saved=output.toByteArray();if(truncated)saved=Arrays.copyOf(saved,3);}
  public void fail(OutputStream out){failed=true;}
  public InputStream read()throws IOException{if(readFails)throw new IOException("read failed");return new ByteArrayInputStream(saved);}
 }
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 public static void main(String[] args){
  MemoryStore success=new MemoryStore();check(AtomicCommit.write(success,NEXT),"successful verified commit");check(Arrays.equals(success.saved,NEXT),"must sync before committing");
  MemoryStore drop=new MemoryStore();drop.drop=true;check(!AtomicCommit.write(drop,NEXT),"silently dropped finish must not report success");
  MemoryStore sync=new MemoryStore();sync.syncFails=true;check(!AtomicCommit.write(sync,NEXT),"sync failure must not report success");check(sync.failed&&Arrays.equals(sync.saved,GOOD),"sync failure preserves previous data");
  MemoryStore read=new MemoryStore();read.readFails=true;check(!AtomicCommit.write(read,NEXT),"unverified readback must not report success");
  MemoryStore truncated=new MemoryStore();truncated.truncated=true;check(!AtomicCommit.write(truncated,NEXT),"truncated readback must not report success");
  check(WebViewSupport.supported("Mozilla/5.0 Chrome/86.0.4240.0 Mobile Safari/537.36"),"supported WebView 86");
  check(WebViewSupport.supported("Mozilla/5.0 Chrome/151.0.0.0 Mobile Safari/537.36"),"supported newer WebView");
  check(!WebViewSupport.supported("Mozilla/5.0 Chrome/85.0.0.0"),"outdated WebView is blocked before JS parses");check(!WebViewSupport.supported(null),"unknown WebView is not assumed compatible");
  System.out.println("PASS platform logic: 11 checks for durable commits, sync/readback failures and WebView compatibility.");
 }
}
