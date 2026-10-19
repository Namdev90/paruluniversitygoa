package in.navrang.gate;

import java.io.IOException;
import java.io.OutputStream;
import java.util.function.BooleanSupplier;

/** Writes one bounded document without reporting success before its destination closes. */
public final class AuthorizedDocumentWriter {
 public static final int MAX_BYTES=12*1024*1024;
 private static final int CHUNK_BYTES=16*1024;

 public enum Result {SAVED,FAILED,STALE}

 @FunctionalInterface public interface Destination {
  OutputStream open() throws IOException;
 }

 private AuthorizedDocumentWriter(){}

 /** The caller refreshes server authority first; allowed must also guard the current identity. */
 public static Result write(byte[] bytes,Destination destination,BooleanSupplier allowed){
  if(bytes==null||bytes.length>MAX_BYTES||destination==null||allowed==null)return Result.FAILED;
  try{
   if(!allowed.getAsBoolean())return Result.STALE;
   boolean authorized=true;
   try(OutputStream out=destination.open()){
    if(out==null)return Result.FAILED;
    for(int offset=0;offset<bytes.length;offset+=CHUNK_BYTES){
     if(!allowed.getAsBoolean()){authorized=false;break;}
     out.write(bytes,offset,Math.min(CHUNK_BYTES,bytes.length-offset));
    }
    if(authorized)out.flush();
   }
   if(!authorized)return Result.STALE;
   return allowed.getAsBoolean()?Result.SAVED:Result.STALE;
  }catch(IOException|RuntimeException failure){
   return Result.FAILED;
  }
 }
}
