package in.navrang.gate;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.*;
public final class QrCodec {
 public static final class Attempt {public final String value;public final float span;public final int points;Attempt(String s,float f,int n){value=s;span=f;points=n;}}
 public static String decode(byte[] frame,int width,int height){return inspect(frame,width,height).value;}
 public static Attempt inspect(byte[] frame,int width,int height){
  if(frame==null||width<=0||height<=0||(long)width*height>frame.length)return new Attempt(null,0,0);
  final List<ResultPoint> points=new ArrayList<>();EnumMap<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.TRY_HARDER,Boolean.TRUE);hints.put(DecodeHintType.NEED_RESULT_POINT_CALLBACK,(ResultPointCallback)points::add);
  PlanarYUVLuminanceSource source=new PlanarYUVLuminanceSource(frame,width,height,0,0,width,height,false);QRCodeReader reader=new QRCodeReader();String value=read(reader,new BinaryBitmap(new HybridBinarizer(source)),hints);
  if(value==null)value=read(reader,new BinaryBitmap(new HybridBinarizer(source.invert())),hints);
  if(value==null&&points.size()>=2)value=read(reader,new BinaryBitmap(new GlobalHistogramBinarizer(source)),hints);
  float minX=Float.MAX_VALUE,maxX=0,minY=Float.MAX_VALUE,maxY=0;for(ResultPoint p:points){minX=Math.min(minX,p.getX());maxX=Math.max(maxX,p.getX());minY=Math.min(minY,p.getY());maxY=Math.max(maxY,p.getY());}
  return new Attempt(value,points.size()<2?0:Math.max(maxX-minX,maxY-minY),points.size());
 }
 private static String read(QRCodeReader r,BinaryBitmap b,Map<DecodeHintType,?> h){try{return r.decode(b,h).getText();}catch(ReaderException|IllegalArgumentException e){return null;}finally{r.reset();}}
}
