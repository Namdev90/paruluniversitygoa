#!/usr/bin/env python3
"""Execute production voice safety policy on a JVM; no microphone, network or provider."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
harness = r'''
import in.navrang.gate.VoiceSafetyState;
import in.navrang.gate.VoiceSafetyState.Snapshot;

public class VoiceSafetyCheck {
  static int checks;
  static void check(boolean value, String detail) { checks++; if (!value) throw new AssertionError(detail); }
  static String id(int n) { return String.format("00000000-0000-4000-8000-%012d", n); }
  static VoiceSafetyState prepared(boolean permission) {
    VoiceSafetyState state = new VoiceSafetyState(true);
    state.identity("account-scope", 1, true, 100);
    state.environment(true, permission, true, 100);
    return state;
  }
  static VoiceSafetyState listening(boolean permission) {
    VoiceSafetyState state = prepared(permission);
    long request = state.beginJoin("channel",100);
    if (request < 0 || !state.joined(request,60_100,100)) throw new AssertionError("fixture join");
    return state;
  }
  static VoiceSafetyState talking() {
    VoiceSafetyState state = listening(true);
    long request = state.press(200);
    if (!state.granted(request,id(1),5,15_200,200)) throw new AssertionError("fixture grant");
    return state;
  }
  static boolean mic(VoiceSafetyState state,long time) { return state.snapshot(time).micAllowed; }

  public static void main(String[] ignored) {
    VoiceSafetyState state = new VoiceSafetyState(false);
    state.identity("account",1,true,100);state.environment(true,true,true,100);
    check(state.beginJoin("channel",100)==-1,"disabled build cannot request join");
    check(state.press(100)==-1 && !mic(state,100),"disabled build cannot capture");

    state=new VoiceSafetyState(true);state.environment(true,true,true,100);
    check(state.beginJoin("channel",100)==-1,"missing identity cannot join");
    state=prepared(true);
    check(state.beginJoin("https://remote.invalid/room",100)==-1,"URL is not a session identifier");
    check(state.beginJoin("",100)==-1,"empty session rejected");
    long join=state.beginJoin(id(10),100);
    check(join>0,"opaque UUID session accepted");
    check(state.beginJoin("channel",100)==-1,"repeated join is not issued");
    check(!mic(state,100) && state.snapshot(100).state.equals("joining"),"joining is receive only");
    check(state.joined(join,60_100,100),"fresh bounded join acknowledged");
    check(state.beginJoin("channel",100)==-1,"connected session cannot auto-rejoin");

    state=listening(false);
    check(state.snapshot(100).connected && !mic(state,100),"receive-only join needs no microphone permission");
    check(state.press(100)==-1,"listen-only state cannot request a floor");
    state.environment(true,true,true,110);
    check(!mic(state,110),"permission grant never starts capture");

    state=prepared(true);state.environment(false,true,true,100);
    check(state.beginJoin("channel",100)==-1,"background join rejected");
    state.environment(true,true,false,100);
    check(state.beginJoin("channel",100)==-1,"join requires audio focus");
    state.environment(true,true,true,100);
    check(!state.snapshot(100).connected,"focus gain never auto-joins");

    state=prepared(true);join=state.beginJoin("channel",100);
    check(!state.joined(join,60_100,10_100),"join callback at timeout rejected");
    check(!state.snapshot(10_100).connected,"timed-out join stays disconnected");
    state=prepared(true);join=state.beginJoin("channel",100);
    check(!state.joined(join,60_101,100),"authority longer than sixty seconds rejected");
    state=prepared(true);join=state.beginJoin("channel",100);
    check(!state.joined(join,100,100),"already expired authority rejected");

    state=prepared(true);join=state.beginJoin("channel",100);state.disconnect(101);
    long nextJoin=state.beginJoin("channel",102);
    check(nextJoin!=join && !state.joined(join,60_103,103),"late old join cannot activate replacement");
    check(state.snapshot(103).state.equals("joining"),"old callback leaves replacement pending");
    check(state.joined(nextJoin,60_104,104),"replacement join can complete");

    state=listening(true);long floor=state.press(200);
    check(floor>0 && state.snapshot(200).pressed && !mic(state,200),"press waits for server floor");
    check(state.press(201)==-1,"repeated key or pointer down cannot issue another floor");
    state.release(202);
    check(!state.granted(floor,id(1),1,15_203,203),"release before grant fences late microphone start");
    check(!mic(state,203) && state.snapshot(203).connected,"release preserves only receive connection");
    long newFloor=state.press(204);
    check(!state.granted(floor,id(1),1,15_205,205),"older grant cannot satisfy a new press");
    check(state.granted(newFloor,id(2),2,15_206,206),"current explicit press accepts exact grant");
    check(mic(state,206) && state.snapshot(206).state.equals("talking"),"capture allowed only after floor acknowledgement");
    Snapshot captured=state.snapshot(206);state.release(207);
    check(captured.leaseId.equals(id(2)) && captured.leaseGeneration==2,"immutable prior snapshot retains cleanup proof");
    check(!mic(state,207) && !state.snapshot(207).pressed,"release is immediately locally muted");

    for (int invalid=0;invalid<4;invalid++) {
      state=listening(true);floor=state.press(200);
      String lease=invalid==0?"not-a-lease":id(1);
      long generation=invalid==1?-1:1;
      long until=invalid==2?15_201:invalid==3?200:15_200;
      check(!state.granted(floor,lease,generation,until,200),"invalid active grant rejected "+invalid);
      check(!mic(state,200) && !state.snapshot(200).pressed,"invalid grant clears press "+invalid);
    }
    state=prepared(true);join=state.beginJoin("channel",100);state.joined(join,5_000,100);floor=state.press(200);
    check(!state.granted(floor,id(1),1,5_001,200),"grant cannot outlive receive authority");
    state=listening(true);floor=state.press(200);
    check(!state.granted(floor,id(1),1,20_200,5_200),"floor callback at five-second timeout rejected");
    check(!state.snapshot(5_200).pressed,"timed-out press is not automatically re-requested");

    state=talking();state.environment(true,true,false,300);
    check(!mic(state,300) && !state.snapshot(300).connected,"any focus loss closes capture and receive transport");
    state.environment(true,true,true,301);
    check(!mic(state,301) && !state.snapshot(301).connected,"focus restoration needs explicit join and press");
    state=talking();state.environment(false,true,true,300);
    check(!mic(state,300) && !state.snapshot(300).connected,"background transition disconnects immediately");
    state=talking();state.environment(true,false,true,300);
    check(!mic(state,300) && state.snapshot(300).connected,"permission revocation removes publishing but preserves listening");
    state.environment(true,true,true,301);
    check(!mic(state,301) && !state.snapshot(301).pressed,"restoring microphone permission never reopens it");
    for(int changed=0;changed<4;changed++) {
      state=talking();state.identity(changed==0?"new-scope":changed==3?"":"account-scope",changed==1?2:1,changed!=2,300);
      check(!mic(state,300) && !state.snapshot(300).connected,"changed or revoked identity closes media "+changed);
    }
    state=talking();state.identity("account-scope",1,true,300);state.environment(true,true,true,300);
    check(mic(state,300),"unchanged authenticated environment does not disrupt a valid press");

    state=talking();check(mic(state,15_199),"capture allowed before exact lease deadline");
    check(!mic(state,15_200) && !state.snapshot(15_200).pressed,"exact lease deadline closes capture");
    check(state.snapshot(15_200).connected,"floor expiry can remain receive-only");
    state=listening(true);
    check(!state.snapshot(60_100).connected,"exact receive-authority deadline disconnects");

    state=talking();long renewal=state.beginRenew(1_000);
    check(renewal>0 && mic(state,1_000),"pending renewal keeps only the current lease");
    check(state.beginRenew(1_001)==-1,"only one renewal is pending");
    check(state.renewed(renewal,id(1),5,16_000,1_001),"current exact lease generation renews");
    check(mic(state,15_999) && !mic(state,16_000),"renewal uses its bounded authoritative deadline");

    state=talking();renewal=state.beginRenew(1_000);
    check(!state.renewed(renewal,id(2),5,16_000,1_001) && !mic(state,1_001),"different lease renewal fails closed");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.renewed(renewal,id(1),6,16_000,1_001) && !mic(state,1_001),"different generation renewal fails closed");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.renewed(renewal,id(1),5,16_002,1_001),"renewal cannot grant over fifteen seconds ahead");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.renewed(renewal,id(1),5,15_000,1_001),"out-of-order shorter renewal fails closed");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.renewed(renewal,id(1),5,20_000,6_000) && !mic(state,6_000),"renewal request timeout mutes before a late reply");
    state=talking();renewal=state.beginRenew(15_000);
    check(!state.renewed(renewal,id(1),5,30_200,15_200),"renewal cannot resurrect an expired lease");
    state=talking();renewal=state.beginRenew(1_000);state.release(1_001);
    check(!state.renewed(renewal,id(1),5,16_002,1_002),"release fences pending renewal");

    state=talking();renewal=state.beginRenew(1_000);state.renewed(renewal,id(1),5,16_000,1_001);
    long nextRenewal=state.beginRenew(2_000);
    check(!state.renewed(renewal,id(1),5,16_000,2_001) && mic(state,2_001),"stale renewal cannot overwrite current renewal");
    check(state.renewed(nextRenewal,id(1),5,17_000,2_002),"current renewal remains eligible after old response");
    state=talking();
    for(long at=10_000;at<=40_000;at+=10_000) {
      renewal=state.beginRenew(at);
      if(!state.renewed(renewal,id(1),5,at+15_000,at))throw new AssertionError("continuous renewal fixture");
    }
    check(mic(state,45_000),"fresh exact renewals have no undocumented thirty-second press cap");

    state=talking();renewal=state.beginRenew(1_000);
    check(state.rotated(renewal,id(2),6,16_000,1_001),"held press accepts a distinct lease with higher generation");
    check(mic(state,1_001) && state.snapshot(1_001).pressed && state.snapshot(1_001).leaseId.equals(id(2)) &&
      state.snapshot(1_001).leaseGeneration==6,"rotation preserves intent and atomically replaces lease identity");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.rotated(renewal,id(1),6,16_000,1_001) && !mic(state,1_001),"same UUID cannot masquerade as rotation");
    state=listening(true);floor=state.press(200);
    String letterId="abcdefab-abcd-4abc-8abc-abcdefabcdef";
    state.granted(floor,letterId,5,15_200,200);renewal=state.beginRenew(1_000);
    check(!state.rotated(renewal,letterId.toUpperCase(java.util.Locale.ROOT),6,16_000,1_001),"UUID casing cannot bypass distinct-lease requirement");
    for(long generation : new long[]{5,4,-1,VoiceSafetyState.MAX_GENERATION+1,Long.MAX_VALUE}) {
      state=talking();renewal=state.beginRenew(1_000);
      check(!state.rotated(renewal,id(2),generation,16_000,1_001) && !mic(state,1_001),"nonincreasing or unsafe rotation generation rejected: "+generation);
    }
    state=talking();renewal=state.beginRenew(1_000);
    check(state.rotated(renewal,id(2),VoiceSafetyState.MAX_GENERATION,16_000,1_001),"maximum safe increasing generation accepted");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.rotated(renewal,"not-a-lease",6,16_000,1_001) && !mic(state,1_001),"malformed replacement lease fails closed");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.rotated(renewal,id(2),6,16_002,1_001),"rotation cannot exceed fifteen-second local authority");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.rotated(renewal,id(2),6,1_001,1_001),"already expired replacement lease rejected");
    state=listening(true);floor=state.press(50_000);state.granted(floor,id(1),5,60_000,50_000);renewal=state.beginRenew(51_000);
    check(!state.rotated(renewal,id(2),6,60_101,51_001),"rotation cannot outlive receive authority");
    state=talking();renewal=state.beginRenew(1_000);state.release(1_001);
    check(!state.rotated(renewal,id(2),6,16_002,1_002) && !mic(state,1_002),"released press rejects a late rotated grant");
    state=talking();renewal=state.beginRenew(15_000);
    check(!state.rotated(renewal,id(2),6,30_200,15_200) && !mic(state,15_200),"rotation cannot revive old lease at exact expiry");
    state=talking();renewal=state.beginRenew(1_000);
    check(!state.rotated(renewal,id(2),6,20_000,6_000) && !mic(state,6_000),"rotation received at request timeout remains muted");
    state=talking();renewal=state.beginRenew(1_000);state.rotated(renewal,id(2),6,16_000,1_001);nextRenewal=state.beginRenew(2_000);
    check(!state.rotated(renewal,id(3),7,17_000,2_001) && mic(state,2_001) && state.snapshot(2_001).leaseId.equals(id(2)),"stale rotation callback cannot replace current lease");
    check(state.rotated(nextRenewal,id(3),7,17_000,2_002),"current held press can rotate again after stale callback");
    state=talking();renewal=state.beginRenew(1_000);state.environment(true,false,true,1_001);
    check(!state.rotated(renewal,id(2),6,16_002,1_002) && !mic(state,1_002),"permission loss fences pending rotation");

    state=listening(true);long epoch=state.snapshot(100).epoch;
    check(state.extendAuthority(epoch,61_000,1_000),"fresh receive authority may extend same epoch");
    check(!state.extendAuthority(epoch-1,62_000,2_000) && state.snapshot(2_000).connected,"stale authority epoch cannot alter current session");
    check(!state.extendAuthority(epoch,62_001,2_000) && !state.snapshot(2_000).connected,"overlong authority extension disconnects");
    state=listening(true);epoch=state.snapshot(100).epoch;
    check(!state.extendAuthority(epoch,50_000,200),"shortened authority response fails closed");
    state=listening(true);epoch=state.snapshot(100).epoch;
    check(!state.extendAuthority(epoch,120_100,60_100),"expired authority cannot be revived by a late heartbeat");

    state=talking();state.environment(false,true,true,true,300);
    check(state.snapshot(300).connected && !mic(state,300),"foreground service retains receive while backgrounding mutes held talk");
    check(state.press(301)==-1 && state.beginRenew(301)==-1,"background reception cannot request or renew a microphone floor");
    state.environment(true,true,true,true,400);
    check(!mic(state,400) && !state.snapshot(400).pressed,"returning to activity never restores a previous press");
    floor=state.press(401);check(state.granted(floor,id(2),6,15_402,402),"fresh explicit foreground press may speak again");
    state.environment(false,true,false,true,500);
    check(state.snapshot(500).connected && !mic(state,500),"receive-only service does not require microphone permission");
    state.environment(false,false,false,true,501);
    check(!state.snapshot(501).connected,"loss of foreground service eligibility immediately ends reception");
    state=prepared(true);state.environment(false,true,true,true,100);
    check(state.beginJoin("channel",101)==-1,"foreground service eligibility alone cannot start a new background join");
    state=talking();state.environment(false,true,true,false,300);
    check(!state.snapshot(300).connected && !mic(state,300),"audio focus loss ends service reception and publishing");
    state=listening(true);state.environment(false,true,true,true,200);
    check(!state.snapshot(60_100).connected,"service retention never extends server authority");

    state=prepared(true);join=state.beginJoin("channel",100);state.failed(join,101);
    check(!state.snapshot(101).connected && state.snapshot(101).joinOperation==-1,"join failure clears pending connection");
    state=listening(true);floor=state.press(200);state.failed(floor,201);
    check(!state.snapshot(201).pressed && !mic(state,201),"floor failure clears pending press");
    state=talking();renewal=state.beginRenew(1_000);state.failed(renewal,1_001);
    check(!mic(state,1_001),"renewal failure immediately mutes");
    state=listening(true);floor=state.press(200);state.release(201);newFloor=state.press(202);state.failed(floor,203);
    check(state.granted(newFloor,id(3),6,15_204,204),"late failure cannot cancel replacement floor request");
    state.disconnect(205);
    check(!mic(state,205) && state.snapshot(205).leaseId.isEmpty(),"transport failure/disconnect clears all capture authority");

    state=talking();check(!mic(state,199),"backwards monotonic clock fails closed");
    state.environment(true,true,true,300);
    check(state.beginJoin("channel",300)==-1,"clock anomaly cannot silently recover capture authority");
    state=talking();check(!mic(state,-1),"negative elapsed clock fails closed");

    System.out.println("Native voice safety: "+checks+" behavioral checks passed (JVM; no microphone, provider or device claims).");
  }
}
'''
(root / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='navrang-voice-policy-', dir=root / '.build') as temp:
    work = Path(temp)
    (work / 'VoiceSafetyCheck.java').write_text(harness, encoding='utf-8')
    source = root / 'native-app/src/main/java/in/navrang/gate/VoiceSafetyState.java'
    subprocess.run(['javac', '--release', '17', '-Xlint:all', '-Werror', '-d', str(work), str(source), str(work / 'VoiceSafetyCheck.java')], check=True)
    subprocess.run(['java', '-cp', str(work), 'VoiceSafetyCheck'], check=True)
