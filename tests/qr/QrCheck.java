import in.navrang.gate.QrCodec;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.common.BitMatrix;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.io.File;
public final class QrCheck {
 public static void main(String[] args)throws Exception{
  String[] ids={"DEMO0001","DEMO0002","ABCDEFG1","O0O0O0O0"};int checks=0;
  new File(args[0]).mkdirs();
  for(String id:ids){
   int n=360;BitMatrix m=new QRCodeWriter().encode(id,BarcodeFormat.QR_CODE,n,n);byte[] data=new byte[n*n];BufferedImage image=new BufferedImage(n,n,BufferedImage.TYPE_INT_RGB);
   for(int y=0;y<n;y++)for(int x=0;x<n;x++){boolean dark=m.get(x,y);data[y*n+x]=(byte)(dark?0:255);image.setRGB(x,y,dark?0:0xffffff);}
   if(!id.equals(QrCodec.decode(data,n,n)))throw new AssertionError("QR decode failed: "+id);checks++;
   byte[] rotated=new byte[n*n];for(int y=0;y<n;y++)for(int x=0;x<n;x++)rotated[x*n+n-1-y]=data[y*n+x];
   if(!id.equals(QrCodec.decode(rotated,n,n)))throw new AssertionError("Rotated QR decode failed: "+id);checks++;
   ImageIO.write(image,"png",new File(args[0],id+".png"));
  }
  byte[] blank=new byte[360*360];java.util.Arrays.fill(blank,(byte)255);if(QrCodec.decode(blank,360,360)!=null)throw new AssertionError("Blank frame must not decode");checks++;
  System.out.println("PASS native QR codec: "+checks+" checks, exact IDs, rotated frames and blank frame.");
 }
}
