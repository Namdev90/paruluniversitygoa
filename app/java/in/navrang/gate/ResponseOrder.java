package in.navrang.gate;
/** Ignore delayed profile replies after a later refresh has already been applied. */
public final class ResponseOrder {
 private long requested,applied;
 public synchronized long begin(){return ++requested;}
 public synchronized boolean accept(long request){if(request<=0||request>requested||request<applied)return false;applied=request;return true;}
}
