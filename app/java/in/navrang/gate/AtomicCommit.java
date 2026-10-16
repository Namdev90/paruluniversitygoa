package in.navrang.gate;
import java.io.InputStream;
import java.io.OutputStream;
public final class AtomicCommit {
 public interface Store {
  OutputStream start() throws Exception;
  void sync(OutputStream out) throws Exception;
  void finish(OutputStream out) throws Exception;
  void fail(OutputStream out);
  InputStream read() throws Exception;
 }
 public static boolean write(Store store,byte[] bytes){
  OutputStream out=null;boolean finished=false;
  try{
   out=store.start();out.write(bytes);out.flush();store.sync(out);store.finish(out);finished=true;
   try(InputStream in=store.read()){
    byte[] buffer=new byte[16384];int position=0,count;
    while((count=in.read(buffer))!=-1){if(position+count>bytes.length)return false;for(int i=0;i<count;i++)if(buffer[i]!=bytes[position+i])return false;position+=count;}
    return position==bytes.length;
   }
  }catch(Exception e){if(out!=null&&!finished)store.fail(out);return false;}
 }
}
