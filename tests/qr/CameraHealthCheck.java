import in.navrang.gate.CameraHealth;
import java.util.Arrays;
public final class CameraHealthCheck {
 public static void main(String[] args){int n=128;byte[] y=new byte[n*n];Arrays.fill(y,(byte)20);if(!CameraHealth.measure(y,n,n).dark())throw new AssertionError("dark frame");Arrays.fill(y,(byte)130);if(CameraHealth.measure(y,n,n).dark()||!CameraHealth.measure(y,n,n).soft())throw new AssertionError("texture-free hint");for(int row=0;row<n;row++)for(int col=0;col<n;col++)y[row*n+col]=(byte)((col/4)%2==0?40:210);if(CameraHealth.measure(y,n,n).soft())throw new AssertionError("edge detail");if(CameraHealth.measure(null,0,0).dark())throw new AssertionError("invalid frame must not turn torch on");System.out.println("PASS camera assistance: dark, texture-free, sharp pattern and invalid frame guards.");}
}
