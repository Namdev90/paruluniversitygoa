package in.navrang.gate;
/** Suppress a held QR, allow the next attendee immediately, and re-arm after absence. */
public final class ScanLatch {
 private String held; private long absentSince=-1;
 public synchronized boolean observe(String value,long now){
  if(value==null){if(absentSince<0)absentSince=now;if(now-absentSince>=600)held=null;return false;}
  absentSince=-1;if(value.equals(held))return false;held=value;return true;
 }
}
