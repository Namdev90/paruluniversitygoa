package in.navrang.gate;

import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntSupplier;
import java.util.function.Predicate;

/** One document owns the picker and subsequent write until completion or identity invalidation. */
public final class ReportSaveCoordinator {
 public enum Kind {REPORT,HELP_DESK}

 public static final class Request {
  public final Kind kind;
  public final String operationId,token,content;
  public final long generation;
  public Request(Kind kind,String operationId,long generation,String token,String content){
   this.kind=Objects.requireNonNull(kind);
   this.operationId=Objects.requireNonNull(operationId);
   this.generation=generation;
   this.token=Objects.requireNonNull(token);
   this.content=Objects.requireNonNull(content);
  }
 }

 private Request current;
 private boolean pickerClaimed;
 private int currentRequestCode=-1;
 private final IntSupplier requestCodes;

 public ReportSaveCoordinator(){this(new AtomicInteger(4096)::getAndIncrement);}
 public ReportSaveCoordinator(IntSupplier requestCodes){this.requestCodes=Objects.requireNonNull(requestCodes);}

 public synchronized boolean begin(Request request){
  if(current!=null||request==null)return false;
  final int code;
  try{code=requestCodes.getAsInt();}catch(RuntimeException failure){return false;}
  if(code<4096||code>65535)return false;
  current=request;pickerClaimed=false;currentRequestCode=code;return true;
 }

 public synchronized boolean busy(){return current!=null;}

 public synchronized int requestCode(Request request){return current==request?currentRequestCode:-1;}

 public synchronized Request claimPicker(int requestCode){
  if(current==null||currentRequestCode!=requestCode||pickerClaimed)return null;
  pickerClaimed=true;return current;
 }

 public synchronized boolean isCurrent(Request request){return request!=null&&current==request;}

 public synchronized boolean finish(Request request){
  if(request==null||current!=request)return false;
  current=null;pickerClaimed=false;currentRequestCode=-1;return true;
 }

 public synchronized void clear(Kind kind){if(current!=null&&current.kind==kind){current=null;pickerClaimed=false;currentRequestCode=-1;}}

 public void retainIf(Predicate<Request> allowed){
  final Request pending;
  synchronized(this){pending=current;}
  if(pending==null)return;
  boolean keep;
  try{keep=allowed.test(pending);}catch(RuntimeException failure){keep=false;}
  if(!keep)finish(pending);
 }
}
