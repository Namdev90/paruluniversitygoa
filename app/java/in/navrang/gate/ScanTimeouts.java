package in.navrang.gate;
import java.util.LinkedHashMap;
import java.util.Map;
/** Monotonic per-ticket deadlines survive camera pauses and cannot be postponed by retries. */
public final class ScanTimeouts {
 private final long timeout;private final LinkedHashMap<String,Long> started=new LinkedHashMap<>();
 public ScanTimeouts(long timeout){if(timeout<0)throw new IllegalArgumentException();this.timeout=timeout;}
 public void start(String id,long now){if(id!=null&&!id.isEmpty()&&!started.containsKey(id))started.put(id,now);}
 public void finish(String id){started.remove(id);}
 public long nextDelay(long now){long next=Long.MAX_VALUE;for(long at:started.values())next=Math.min(next,Math.max(0,timeout-(now-at)));return next==Long.MAX_VALUE?-1:next;}
 public String expired(long now){for(Map.Entry<String,Long> e:started.entrySet())if(now-e.getValue()>=timeout)return e.getKey();return null;}
}
