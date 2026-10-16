package in.navrang.gate;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
public final class Pkce {
 private static final char[] B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();
 static String encode(byte[] bytes){StringBuilder b=new StringBuilder();int bits=0,value=0;for(byte n:bytes){value=(value<<8)|(n&255);bits+=8;while(bits>=6){bits-=6;b.append(B64[(value>>bits)&63]);}}if(bits>0)b.append(B64[(value<<(6-bits))&63]);return b.toString();}
 public static String verifier(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return encode(b);}
 public static String challenge(String verifier){try{return encode(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));}catch(Exception e){throw new IllegalStateException(e);}}
}
