package in.navrang.gate;
public final class NativeRelayClockProbeTest {
 public static void main(String[] args){
  String nonce="a".repeat(32),body="{\"version\":1,\"nonce\":\""+nonce+"\",\"serverTime\":1800000000000}";
  NativeRelayClockProbe.Sample sample=NativeRelayClockProbe.parse(body,nonce,10,20);
  if(sample.serverUnixMs!=1800000000000L||sample.sentElapsedMs!=10||sample.receivedElapsedMs!=20)throw new AssertionError();
  int rejected=0;
  for(String invalid:new String[]{body+" ",body.replace(nonce,"b".repeat(32)),body.replace("version\":1","version\":2"),body.replace("1800000000000","9007199254740992"),body.replace("1800000000000","-1"),body.replace("}",",\"extra\":true}")}){
   try{NativeRelayClockProbe.parse(invalid,nonce,10,20);throw new AssertionError();}catch(IllegalArgumentException expected){rejected++;}
  }
  try{NativeRelayClockProbe.parse(body,nonce,10,2011);throw new AssertionError();}catch(IllegalArgumentException expected){rejected++;}
  System.out.println("PASS native same-room clock probe parser: "+(rejected+1)+" checks");
 }
}
