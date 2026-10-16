import java.lang.reflect.*;
public final class LiveLogicCheck {
 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  Class<?> cls=null;try{cls=Class.forName("in.navrang.gate.ScanLatch");}catch(ClassNotFoundException ignored){}
  check(cls!=null,"Continuous scanner latch is missing");Object latch=cls.getConstructor().newInstance();Method scan=cls.getMethod("observe",String.class,long.class);
  check((Boolean)scan.invoke(latch,"DEMO0001",1000L),"first QR should submit");
  check(!(Boolean)scan.invoke(latch,"DEMO0001",1050L),"same visible QR must not resubmit");
  check((Boolean)scan.invoke(latch,"DEMO0002",1100L),"new QR must submit without waiting for the popup");
  check(!(Boolean)scan.invoke(latch,"DEMO0002",1500L),"same QR remains latched");
  scan.invoke(latch,null,1550L);scan.invoke(latch,null,2200L);
  check((Boolean)scan.invoke(latch,"DEMO0002",2250L),"QR returning after leaving view can be checked for duplicate");
  Class<?> pk=Class.forName("in.navrang.gate.Pkce");String verifier=(String)pk.getMethod("verifier").invoke(null);
  check(verifier.length()>=43&&verifier.matches("[A-Za-z0-9_-]+"),"PKCE verifier needs secure URL-safe entropy");
  String challenge=(String)pk.getMethod("challenge",String.class).invoke(null,"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  check(challenge.equals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"),"RFC7636 SHA256 challenge");
  System.out.println("PASS live logic: repeated-frame suppression, immediate different QR, leave/re-enter and RFC7636 PKCE.");
 }
}
