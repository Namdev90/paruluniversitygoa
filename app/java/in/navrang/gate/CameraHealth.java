package in.navrang.gate;
/** Lightweight central luminance / texture hints, not a calibrated blur detector. */
public final class CameraHealth {
 public final double luminance,detail;
 private CameraHealth(double l,double d){luminance=l;detail=d;}
 public static CameraHealth measure(byte[] y,int width,int height){
  if(y==null||width<16||height<16||y.length<(long)width*height)return new CameraHealth(128,0);
  long sum=0,edges=0;int n=0;for(int row=height/4;row<height*3/4;row+=8)for(int col=width/4;col<width*3/4-4;col+=8){int k=row*width+col,v=y[k]&255;sum+=v;edges+=Math.abs(v-(y[k+4]&255));n++;}
  return new CameraHealth(n==0?128:(double)sum/n,n==0?0:(double)edges/n);
 }
 public boolean dark(){return luminance<45;}
 public boolean soft(){return luminance>=45&&detail<8;}
}
