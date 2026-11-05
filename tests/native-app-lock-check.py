#!/usr/bin/env python3
"""Exercise real app-lock state using a monotonic clock; no biometric is simulated."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
harness = r'''
import in.navrang.gate.AppLockState;
public class AppLockCheck {
 static int checks;static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
 public static void main(String[] args){
  long[] elapsed={1000};AppLockState state=new AppLockState(()->elapsed[0]);
  check(!state.isUnlocked(),"a cold process has no persisted unlock");
  check(state.beginPrompt()==0,"background work cannot launch authentication");state.foreground();
  long first=state.beginPrompt();check(first>0&&state.beginPrompt()==0,"one authentication is allowed in flight");
  check(state.authenticated(first)&&state.isUnlocked(),"the current foreground authentication unlocks the app");
  check(state.beginPrompt()==0,"a duplicate resume does not prompt an unlocked user");
  state.background();elapsed[0]=30900;state.foreground();check(state.isUnlocked(),"return at 29.9 seconds uses the in-memory unlock");
  elapsed[0]=40000;state.background();elapsed[0]=70000;state.foreground();check(!state.isUnlocked(),"return at exactly 30 seconds requires authentication");
  long second=state.beginPrompt();state.cancelled(second);check(!state.isUnlocked(),"cancellation fails closed");
  long third=state.beginPrompt();check(third!=second&&!state.authenticated(second),"late cancelled prompt cannot unlock a replacement prompt");
  check(state.authenticated(third),"a deliberate retry can authenticate");
  state.screenLocked();check(!state.isUnlocked(),"screen/device lock revokes the in-memory unlock immediately");
  long screenPrompt=state.beginPrompt();state.screenLocked();check(!state.authenticated(screenPrompt),"an old success after device lock is ignored");
  long valid=state.beginPrompt();check(state.authenticated(valid),"new authentication can proceed after a lock");
  elapsed[0]=80000;state.background();elapsed[0]=90000;state.background();elapsed[0]=110000;
  check(!state.isUnlocked(),"duplicate background callbacks cannot extend the grace period");state.foreground();
  check(state.authenticated(state.beginPrompt()),"unlock before identity change");state.identityChanged();
  check(!state.isUnlocked(),"a new login cannot inherit the previous account's unlock");
  check(state.authenticated(state.beginPrompt()),"unlock before monotonic reset fixture");elapsed[0]=120000;state.background();elapsed[0]=110000;state.foreground();
  check(!state.isUnlocked(),"invalid monotonic elapsed time fails closed");
  check(!new AppLockState(()->elapsed[0]).isUnlocked(),"process death always requires fresh authentication");
  state.foreground();long pending=state.beginPrompt();state.background();check(!state.authenticated(pending),"a hidden activity cannot accept an authentication callback");state.foreground();
  check(!state.isUnlocked(),"return after a hidden success stays locked");
  System.out.println("PASS actual AppLockState: "+checks+" monotonic grace, prompt, cancellation and process checks.");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-app-lock-') as temp:
    folder = Path(temp)
    java = folder / 'AppLockCheck.java'
    java.write_text(harness)
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), str(java), str(root / 'app/java/in/navrang/gate/AppLockState.java')], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'AppLockCheck'], check=True, timeout=10)
