package in.navrang.gate;

import java.util.function.LongSupplier;

/** Process-memory policy only. Supply Android elapsedRealtime, never wall time. */
public final class AppLockState {
 private final LongSupplier elapsedMillis;
 private boolean unlocked,foreground;
 private long backgroundAt=-1,promptSequence,prompt;
 public AppLockState(LongSupplier elapsedMillis){this.elapsedMillis=elapsedMillis;}
 public synchronized void foreground(){expire();foreground=true;backgroundAt=-1;}
 public synchronized void background(){if(!foreground)return;foreground=false;backgroundAt=elapsedMillis.getAsLong();}
 public synchronized boolean isUnlocked(){expire();return unlocked;}
 private void expire(){
  if(!unlocked||backgroundAt<0)return;
  long elapsed=elapsedMillis.getAsLong()-backgroundAt;
  if(elapsed<0||elapsed>=30000)lock();
 }
 public synchronized long beginPrompt(){expire();if(!foreground||unlocked||prompt!=0)return 0;prompt=++promptSequence;return prompt;}
 public synchronized boolean authenticated(long operation){
  if(operation==0||operation!=prompt)return false;
  prompt=0;if(!foreground)return false;unlocked=true;backgroundAt=-1;return true;
 }
 public synchronized void cancelled(long operation){if(operation==prompt)prompt=0;}
 public synchronized void screenLocked(){lock();}
 public synchronized void identityChanged(){lock();}
 private void lock(){unlocked=false;prompt=0;promptSequence++;}
}
