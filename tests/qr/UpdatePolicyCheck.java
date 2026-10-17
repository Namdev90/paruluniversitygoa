import in.navrang.gate.UpdatePolicy;
import java.io.*;
public final class UpdatePolicyCheck {
 private static int checks;
 private static void rejected(int code,String name,String url,long bytes,String hash){try{UpdatePolicy.validate(code,name,url,bytes,hash);throw new AssertionError("unsafe update accepted");}catch(IllegalArgumentException expected){checks++;}}
 public static void main(String[] args)throws Exception{String h=new String(new char[64]).replace('\0','a'),name="0.4.0",url=UpdatePolicy.ROOT+"downloads/Navrang-Gate-0.4.0.apk";UpdatePolicy.validate(4,name,url,1500000,h);checks++;rejected(0,name,url,1500000,h);rejected(4,"bad",url,1500000,h);rejected(4,name,"http://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/Navrang-Gate-0.4.0.apk",1500000,h);rejected(4,name,"https://example.com/Navrang-Gate-0.4.0.apk",1500000,h);rejected(4,name,url+"?redirect=https://evil.test",1500000,h);rejected(4,name,url,UpdatePolicy.MAX_APK+1,h);rejected(4,name,url,50,h);rejected(4,name,url,1500000,"bad");if(!UpdatePolicy.digest("abc".getBytes("UTF-8")).equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"))throw new AssertionError("digest mismatch");checks++;System.out.println("PASS update policy: "+checks+" channel, version, size and digest checks.");}
}
