package in.navrang.gate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
public final class WebViewSupport {
 public static boolean supported(String userAgent){
  if(userAgent==null)return false;Matcher match=Pattern.compile("Chrome/(\\d+)").matcher(userAgent);
  try{return match.find()&&Integer.parseInt(match.group(1))>=86;}catch(NumberFormatException e){return false;}
 }
}
