package in.navrang.gate;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real platform mono Opus/PCM ports. No disk, recording export, retry, or background microphone. */
public final class NativeRelayAudio implements RelayV1Driver.AudioFactory {
    private final Context context;private final RelayV1Driver.Time time;
    public NativeRelayAudio(Context context,RelayV1Driver.Time time){this.context=context.getApplicationContext();this.time=time;}
    private static MediaFormat encoderFormat(){
        MediaFormat format=MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS,48000,1);
        format.setInteger(MediaFormat.KEY_BIT_RATE,24000);
        format.setInteger(MediaFormat.KEY_PCM_ENCODING,AudioFormat.ENCODING_PCM_16BIT);
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE,1920);return format;
    }
    /** Android guarantees Opus encoding only from API29; older vendors may supply it.
     * Capability discovery does not open a microphone or prove physical encoder timing.
     */
    static String encoderName(){
        try{return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(encoderFormat());}
        catch(RuntimeException|LinkageError unavailable){return null;}
    }
    static boolean encoderAvailable(){return encoderName()!=null||BundledRelayEncoder.available();}
    public RelayV1Driver.Audio open(WebSocketAudioRelayTransport.Role role,long until,long unix,RelayV1Driver.Capture capture,WebSocketAudioRelayTransport.Completion ready){
        Port port=new Port(role,until,unix,capture,ready);port.start();return port;
    }
    private final class Port implements RelayV1Driver.Audio {
        final WebSocketAudioRelayTransport.Role role;final RelayV1Driver.Capture capture;final WebSocketAudioRelayTransport.Completion ready;
        final HandlerThread thread=new HandlerThread("Navrang Opus",android.os.Process.THREAD_PRIORITY_AUDIO);final Handler worker;
        final AtomicBoolean invalid=new AtomicBoolean();final Object lock=new Object();
        final List<WebSocketAudioRelayTransport.Completion> releaseCallbacks=new ArrayList<>();
        MediaCodec codec;BundledRelayEncoder software;AudioRecord record;AudioTrack track;Pending packet;boolean released,releaseSuccess=true,microphone;
        final byte[] encoded=new byte[2048];
        volatile boolean initialized;volatile long hardUntil,hardUnix;final byte[] pcm=new byte[1920];int pcmBytes;long capturedAt;
        Port(WebSocketAudioRelayTransport.Role role,long until,long unix,RelayV1Driver.Capture capture,WebSocketAudioRelayTransport.Completion ready){
            this.role=role;hardUntil=until;hardUnix=unix;this.capture=capture;this.ready=ready;thread.start();worker=new Handler(thread.getLooper());
        }
        final class Pending {
            final byte[] opus;final boolean reset;final long expires,unix;final WebSocketAudioRelayTransport.Completion consumed;
            boolean queued,resetDone;ByteBuffer decoded;long timestamp;RelayPlaybackFence playback;
            Pending(byte[] opus,boolean reset,long expires,long unix,WebSocketAudioRelayTransport.Completion consumed){this.opus=opus.clone();this.reset=reset;this.expires=expires;this.unix=unix;this.consumed=consumed;}
            void wipe(){Arrays.fill(opus,(byte)0);if(decoded!=null){decoded.clear();while(decoded.hasRemaining())decoded.put((byte)0);decoded=null;}}
        }
        void start(){worker.post(()->{try{
            if(!valid())throw new IllegalStateException();
            if(role==WebSocketAudioRelayTransport.Role.PUBLISHER){
                if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw new IllegalStateException();
                String encoder=encoderName();
                if(encoder==null)software=new BundledRelayEncoder();
                else {codec=MediaCodec.createByCodecName(encoder);codec.configure(encoderFormat(),null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);codec.start();}
                int minimum=AudioRecord.getMinBufferSize(48000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
                if(minimum<=0||minimum>24000)throw new IllegalStateException();
                record=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(Math.max(minimum,3840)).build();if(record.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException();
            }else{
                decoder();int minimum=AudioTrack.getMinBufferSize(48000,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT);
                if(minimum<=0||minimum>192000)throw new IllegalStateException();
                track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum,1920)).build();
                if(track.getState()!=AudioTrack.STATE_INITIALIZED)throw new IllegalStateException();configureOutput();track.play();
            }
            if(!valid())throw new IllegalStateException();initialized=true;ready.complete(true);worker.post(pump);
        }catch(Exception|LinkageError failure){ready.complete(false);invalidate();}});}
        boolean valid(){long now=time.now(),unix=time.serverUpperBoundUnixMs();return !invalid.get()&&now>=0&&unix>=0&&now<hardUntil&&unix<hardUnix;}
        void decoder()throws Exception {
            MediaFormat format=MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS,48000,1);
            ByteBuffer head=ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN);head.put("OpusHead".getBytes(StandardCharsets.US_ASCII)).put((byte)1).put((byte)1).putShort((short)0).putInt(48000).putShort((short)0).put((byte)0);head.flip();
            ByteBuffer skip=ByteBuffer.allocate(8).order(ByteOrder.nativeOrder()).putLong(0);skip.flip();
            ByteBuffer preroll=ByteBuffer.allocate(8).order(ByteOrder.nativeOrder()).putLong(80000000);preroll.flip();
            format.setByteBuffer("csd-0",head);format.setByteBuffer("csd-1",skip);format.setByteBuffer("csd-2",preroll);
            format.setInteger(MediaFormat.KEY_PCM_ENCODING,AudioFormat.ENCODING_PCM_16BIT);
            codec=MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS);codec.configure(format,null,null,0);codec.start();
        }
        final Runnable pump=new Runnable(){public void run(){
            if(!valid()){invalidate();return;}
            try{if(role==WebSocketAudioRelayTransport.Role.PUBLISHER)encode();else decode();}
            catch(Exception|LinkageError failure){invalidate();return;}
            if(!invalid.get())worker.postDelayed(this,5);
        }};
        void encode(){
            if(!microphone)return;
            if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){invalidate();return;}
            if(software!=null){
                if(!readPcm())return;
                byte[] packet=null;
                try {
                    int count=software.encode(pcm,encoded);
                    if(count<2||count>2048)throw new IllegalStateException();
                    packet=Arrays.copyOf(encoded,count);
                    if(!RelayOpusPacket.twentyMsMono(packet))throw new IllegalStateException();
                    long elapsed=time.now();
                    if(valid()&&microphone&&capturedAt>=0&&elapsed>=capturedAt&&elapsed-capturedAt<250)capture.opus(packet,capturedAt);
                } finally {Arrays.fill(pcm,(byte)0);pcmBytes=0;Arrays.fill(encoded,(byte)0);if(packet!=null)Arrays.fill(packet,(byte)0);}
                return;
            }
            MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
            for(int count=0;count<4&&valid();count++){
                int index=codec.dequeueOutputBuffer(info,0);if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED)continue;if(index<0)break;
                byte[] opus=null;try{
                    if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0&&info.size>0){if(info.size>2048)throw new IllegalStateException();ByteBuffer bytes=codec.getOutputBuffer(index);if(bytes==null)throw new IllegalStateException();
                        bytes.position(info.offset);bytes.limit(info.offset+info.size);opus=new byte[info.size];bytes.get(opus);
                        if(!RelayOpusPacket.twentyMsMono(opus))throw new IllegalStateException();
                        long captured=info.presentationTimeUs/1000;if(captured<0||captured>time.now()||time.now()-captured>=250)continue;
                        if(valid()&&microphone)capture.opus(opus,captured);
                    }
                }finally{codec.releaseOutputBuffer(index,false);if(opus!=null)Arrays.fill(opus,(byte)0);}
            }
            if(!valid()||!microphone)return;
            if(readPcm()){int index=codec.dequeueInputBuffer(0);if(index>=0){ByteBuffer input=codec.getInputBuffer(index);if(input==null||input.capacity()<pcm.length)throw new IllegalStateException();input.clear();input.put(pcm);
                codec.queueInputBuffer(index,0,pcm.length,capturedAt*1000,0);Arrays.fill(pcm,(byte)0);pcmBytes=0;}}
        }
        boolean readPcm(){
            if(pcmBytes==0)capturedAt=time.now();
            int read=record.read(pcm,pcmBytes,pcm.length-pcmBytes,AudioRecord.READ_NON_BLOCKING);
            if(read<0||(read&1)!=0)throw new IllegalStateException();pcmBytes+=read;
            long now=time.now();
            if(now<capturedAt||now-capturedAt>=250){Arrays.fill(pcm,(byte)0);pcmBytes=0;return false;}
            return pcmBytes==pcm.length;
        }
        void resetDecoder()throws Exception {
            track.pause();track.flush();codec.stop();codec.release();codec=null;decoder();configureOutput();track.play();
        }
        void configureOutput(){
            // API24+ can reduce the effective PCM buffer, which also bounds the
            // startup fill requirement on older APIs. Reject routes that cannot
            // start with the single packet allowed by relay credit.
            int actual=track.setBufferSizeInFrames(960);
            if(actual<=0||actual>960)throw new IllegalStateException();
            if(Build.VERSION.SDK_INT>=31)track.setStartThresholdInFrames(1);
            if(!outputCompatible())throw new IllegalStateException();
        }
        boolean outputCompatible(){
            int buffer=track.getBufferSizeInFrames();
            int threshold=Build.VERSION.SDK_INT>=31?track.getStartThresholdInFrames():buffer;
            return RelayPlaybackFence.outputCanStart(buffer,threshold);
        }
        void decode()throws Exception {
            Pending current;synchronized(lock){current=packet;}if(current==null)return;
            if(!outputCompatible())throw new IllegalStateException();
            if(time.now()>=current.expires||time.serverUpperBoundUnixMs()>=current.unix){resetDecoder();consumed(current,true);return;}
            if(!current.queued){if(current.reset&&!current.resetDone){resetDecoder();current.resetDone=true;}int index=codec.dequeueInputBuffer(0);if(index<0)return;
                ByteBuffer input=codec.getInputBuffer(index);if(input==null||input.capacity()<current.opus.length)throw new IllegalStateException();input.clear();input.put(current.opus);
                current.timestamp=time.now()*1000;codec.queueInputBuffer(index,0,current.opus.length,current.timestamp,0);current.queued=true;Arrays.fill(current.opus,(byte)0);}
            if(current.decoded==null){MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();int index=codec.dequeueOutputBuffer(info,0);
                if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){MediaFormat format=codec.getOutputFormat();if(format.getInteger(MediaFormat.KEY_SAMPLE_RATE)!=48000||format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)!=1||
                    format.containsKey(MediaFormat.KEY_PCM_ENCODING)&&format.getInteger(MediaFormat.KEY_PCM_ENCODING)!=AudioFormat.ENCODING_PCM_16BIT)throw new IllegalStateException();return;}
                if(index<0)return;try{if(info.size<=0)return;if(info.size>1920||info.presentationTimeUs!=current.timestamp)throw new IllegalStateException();
                    ByteBuffer decoded=codec.getOutputBuffer(index);if(decoded==null)throw new IllegalStateException();decoded.position(info.offset);decoded.limit(info.offset+info.size);
                    current.decoded=ByteBuffer.allocate(info.size);current.decoded.put(decoded).flip();}finally{codec.releaseOutputBuffer(index,false);}}
            if(!valid()||time.now()>=current.expires){resetDecoder();consumed(current,true);return;}
            // Retain one packet's credit AND expiry until native progress consumes it.
            // write() admission is not playback; a large platform buffer must never
            // accumulate packets whose individual deadlines have been discarded.
            if(current.playback==null)current.playback=new RelayPlaybackFence(current.expires,current.unix,track.getPlaybackHeadPosition()&0xffffffffL);
            if(current.decoded.hasRemaining()){
                int count=track.write(current.decoded,current.decoded.remaining(),AudioTrack.WRITE_NON_BLOCKING);
                if(!current.playback.written(count))throw new IllegalStateException();
            }
            RelayPlaybackFence.State state=current.playback.state(track.getPlaybackHeadPosition()&0xffffffffL,
                time.now(),time.serverUpperBoundUnixMs(),!current.decoded.hasRemaining());
            if(state==RelayPlaybackFence.State.INVALID)throw new IllegalStateException();
            if(state==RelayPlaybackFence.State.EXPIRED){resetDecoder();consumed(current,true);}
            else if(state==RelayPlaybackFence.State.DRAINED)consumed(current,true);
        }
        void consumed(Pending current,boolean success){synchronized(lock){if(packet!=current)return;packet=null;}current.wipe();current.consumed.complete(success);}
        public void microphone(boolean enabled,VoiceMediaTransport.InputResult result){
            if(!enabled){abort(success->{if(success)result.applied(false);else result.failed();});return;}
            if(invalid.get()||role!=WebSocketAudioRelayTransport.Role.PUBLISHER){result.failed();return;}
            if(!worker.post(()->{try{if(!initialized||!valid()||context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw new IllegalStateException();
                record.startRecording();if(record.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING||!valid())throw new IllegalStateException();microphone=true;result.applied(true);
            }catch(Exception failure){result.failed();invalidate();}}))result.failed();
        }
        public boolean playOpus(byte[] opus,boolean reset,long expires,long unix,WebSocketAudioRelayTransport.Completion consumed){
            synchronized(lock){if(invalid.get()||!initialized||role!=WebSocketAudioRelayTransport.Role.RECEIVER||packet!=null||!RelayOpusPacket.twentyMsMono(opus)||expires<=time.now())return false;
                hardUnix=Math.min(hardUnix,unix);packet=new Pending(opus,reset,expires,unix,consumed);return true;}
        }
        public void abort(WebSocketAudioRelayTransport.Completion completion){boolean done;synchronized(lock){done=released;if(!done)releaseCallbacks.add(completion);}
            if(done)completion.complete(releaseSuccess);else invalidate();}
        void invalidate(){if(!invalid.compareAndSet(false,true))return;worker.post(this::release);}
        void release(){
            microphone=false;worker.removeCallbacks(pump);Pending pending;synchronized(lock){pending=packet;packet=null;}
            if(pending!=null){pending.wipe();try{pending.consumed.complete(false);}catch(RuntimeException ignored){}}
            if(record!=null){try{if(record.getRecordingState()==AudioRecord.RECORDSTATE_RECORDING)record.stop();}catch(Exception failure){releaseSuccess=false;}
                try{record.release();}catch(Exception failure){releaseSuccess=false;}record=null;}
            if(track!=null){try{track.pause();track.flush();track.stop();}catch(Exception failure){releaseSuccess=false;}
                try{track.release();}catch(Exception failure){releaseSuccess=false;}track=null;}
            if(codec!=null){try{codec.stop();}catch(Exception failure){releaseSuccess=false;}try{codec.release();}catch(Exception failure){releaseSuccess=false;}codec=null;}
            if(software!=null){try{software.close();}catch(RuntimeException|LinkageError failure){releaseSuccess=false;}software=null;}
            Arrays.fill(pcm,(byte)0);Arrays.fill(encoded,(byte)0);List<WebSocketAudioRelayTransport.Completion> callbacks;
            synchronized(lock){released=true;callbacks=new ArrayList<>(releaseCallbacks);releaseCallbacks.clear();}
            for(WebSocketAudioRelayTransport.Completion done:callbacks)try{done.complete(releaseSuccess);}catch(RuntimeException ignored){}
            thread.quitSafely();
        }
    }
}
