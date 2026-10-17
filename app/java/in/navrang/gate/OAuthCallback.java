package in.navrang.gate;
import java.net.URI;
import java.net.URLDecoder;
import java.util.*;
/** Parse both query and fragment errors without displaying credentials or authorization codes. */
public final class OAuthCallback {
 public final String code,error,message;
 private OAuthCallback(String code,String error,String message){this.code=code;this.error=error;this.message=message;}
 private static void add(Map<String,String> out,String raw)throws Exception{if(raw==null)return;for(String pair:raw.split("&")){String[] p=pair.split("=",2);String k=URLDecoder.decode(p[0],"UTF-8"),v=p.length>1?URLDecoder.decode(p[1],"UTF-8"):"";if(v.length()>8192)throw new IllegalArgumentException();if(out.containsKey(k)&&!out.get(k).equals(v))throw new IllegalArgumentException();out.put(k,v);}}
 public static OAuthCallback parse(String url,String expected){try{URI u=new URI(url);if(!"navranggate".equals(u.getScheme())||!"auth-callback".equals(u.getHost())||expected==null||expected.isEmpty())return null;Map<String,String> p=new HashMap<>();add(p,u.getRawQuery());add(p,u.getRawFragment());if(!expected.equals(p.get("state")))return null;String error=p.getOrDefault("error",p.getOrDefault("error_code","")),code=p.getOrDefault("code","");if(!error.isEmpty())return new OAuthCallback("",error,errorMessage(error,p.getOrDefault("error_description","")));return new OAuthCallback(code,"",code.isEmpty()?"Google did not return a sign-in code. Start sign-in again.":"");}catch(Exception e){return null;}}
 public static String errorMessage(String error,String description){String text=(error+" "+description).toLowerCase(Locale.US);if(text.contains("access_denied")||text.contains("cancel"))return "Google sign-in was cancelled. Tap Continue with Google to try again, or use your assigned checker code.";if(text.contains("invalid_client")||text.contains("client secret")||text.contains("unable to exchange")||text.contains("unexpected_failure")||text.contains("server_error"))return "Google sign-in setup needs the organizer’s attention. Namdev must check the Google client ID and client secret in Supabase. Use an assigned checker code meanwhile.";return "Google could not complete sign-in. Try again with a working connection, or use your assigned checker code.";}
}
