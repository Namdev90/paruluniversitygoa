package in.navrang.gate;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.EnumMap;
public final class QrCodec {
 public static String decode(byte[] frame,int width,int height){
  if(frame==null||width<=0||height<=0||frame.length<width*height)return null;
  try{
   PlanarYUVLuminanceSource source=new PlanarYUVLuminanceSource(frame,width,height,0,0,width,height,false);
   EnumMap<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.TRY_HARDER,Boolean.TRUE);
   return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)),hints).getText();
  }catch(com.google.zxing.ReaderException|IllegalArgumentException e){return null;}
 }
}
