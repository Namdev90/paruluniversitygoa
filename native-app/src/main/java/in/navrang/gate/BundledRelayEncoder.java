package in.navrang.gate;

import java.util.Arrays;

/** Tiny app-owned libopus boundary. A missing ABI/library fails closed, never downloads code. */
final class BundledRelayEncoder implements AutoCloseable {
    private static final boolean AVAILABLE;
    static {
        boolean loaded=false;
        try { System.loadLibrary("navrang_opus");loaded=true; }
        catch(SecurityException|LinkageError unavailable) { }
        AVAILABLE=loaded;
    }
    private long handle;
    private final short[] samples=new short[960];
    static boolean available(){return AVAILABLE;}
    BundledRelayEncoder(){
        if(!AVAILABLE||(handle=nativeCreate())==0)throw new IllegalStateException("Bundled encoder unavailable");
    }
    synchronized int encode(byte[] pcm,byte[] output){
        if(output!=null)Arrays.fill(output,(byte)0);
        if(handle==0||pcm==null||pcm.length!=1920||output==null||output.length!=2048)return -1;
        try {
            for(int i=0;i<samples.length;i++)samples[i]=(short)((pcm[i*2]&255)|(pcm[i*2+1]<<8));
            int count=nativeEncode(handle,samples,output);
            if(count<2||count>2048){Arrays.fill(output,(byte)0);return -1;}
            return count;
        } finally { Arrays.fill(samples,(short)0); }
    }
    @Override public synchronized void close(){
        long previous=handle;handle=0;
        if(previous!=0)nativeDestroy(previous);
        Arrays.fill(samples,(short)0);
    }
    private static native long nativeCreate();
    private static native int nativeEncode(long handle,short[] pcm,byte[] output);
    private static native void nativeDestroy(long handle);
}
