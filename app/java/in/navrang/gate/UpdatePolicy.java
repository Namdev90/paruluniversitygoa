package in.navrang.gate;
import java.io.*;
import java.security.MessageDigest;
/** Shared, testable rules for this APK distribution channel. */
public final class UpdatePolicy {
 public static final String APP_ID="in.navrang.gate",ROOT="https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/",MANIFEST=ROOT+"updates/latest.json";
 public static final long MAX_APK=25L*1024*1024;
 public static void validate(int version,String name,String url,long bytes,String hash){
  if(version<1||name==null||!name.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?")||!url.equals(ROOT+"downloads/Navrang-Gate-"+name+".apk")||bytes<100000||bytes>MAX_APK||hash==null||!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid app update metadata.");
 }
 public static String digest(byte[] value)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(value));}
 public static String hex(byte[] value){StringBuilder b=new StringBuilder();for(byte v:value)b.append(String.format(java.util.Locale.US,"%02x",v&255));return b.toString();}
 public static String hash(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return hex(d.digest());}
}
