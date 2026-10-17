package in.navrang.gate;
public class OAuthCallbackCheck {
 static int checks;static void check(boolean ok){checks++;if(!ok)throw new AssertionError("OAuth check "+checks);}
 public static void main(String[] args){
  OAuthCallback good=OAuthCallback.parse("navranggate://auth-callback?state=nonce&code=valid-code","nonce");check(good!=null&&good.code.equals("valid-code"));
  check(OAuthCallback.parse("navranggate://auth-callback?state=other&code=x","nonce")==null);
  check(OAuthCallback.parse("https://auth-callback?state=nonce&code=x","nonce")==null);
  check(OAuthCallback.parse("navranggate://auth-callback?state=nonce&code=x#state=other","nonce")==null);
  OAuthCallback denied=OAuthCallback.parse("navranggate://auth-callback?state=nonce#error=access_denied","nonce");check(denied.message.contains("cancelled"));
  OAuthCallback broken=OAuthCallback.parse("navranggate://auth-callback?state=nonce#error=server_error&error_description=Unable+to+exchange+external+code%3A+DO-NOT-ECHO","nonce");check(broken.code.isEmpty()&&broken.message.contains("client secret")&&!broken.message.contains("DO-NOT-ECHO")&&!broken.message.contains("cancelled"));
  OAuthCallback precedence=OAuthCallback.parse("navranggate://auth-callback?state=nonce&code=unsafe#error=server_error","nonce");check(precedence.code.isEmpty());
  check(OAuthCallback.parse("navranggate://auth-callback?state=nonce&code=x","")==null);
  check(OAuthCallback.parse("navranggate://auth-callback?state=nonce&code=%zz","nonce")==null);
  check(OAuthCallback.parse("navranggate://auth-callback?state=nonce&code=x#state=nonce","nonce").code.equals("x"));
  System.out.println("PASS: "+checks+" native OAuth callback checks");
 }
}
