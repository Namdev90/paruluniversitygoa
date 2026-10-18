import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import javax.imageio.ImageIO;

/** Deterministic original-art extraction. Never redraws the institution or event logo. */
public final class PrepareBrands {
 private static final String POSTER_SHA256="1954655e04b0ef92d1a1f820271171062e55b2ef28a40741efa4487bb415319f";
 private static String sha(byte[] bytes)throws Exception{
  StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format("%02x",b&255));return out.toString();
 }
 private static void png(BufferedImage image,Path path)throws Exception{
  Files.createDirectories(path.getParent());if(!ImageIO.write(image,"png",path.toFile()))throw new IllegalStateException("PNG encoder unavailable");
 }
 public static void main(String[] args)throws Exception{
  System.setProperty("java.awt.headless","true");
  if(args.length<1||args.length>2)throw new IllegalArgumentException("Usage: java tools/PrepareBrands.java SOURCE_ROOT [OUTPUT_ROOT]");
  Path root=Paths.get(args[0]).toAbsolutePath().normalize(),output=args.length==2?Paths.get(args[1]).toAbsolutePath().normalize():root;
  Path source=root.resolve("app/assets/art/event-poster.jpg");byte[] bytes=Files.readAllBytes(source);
  if(!POSTER_SHA256.equals(sha(bytes)))throw new IllegalStateException("Brochure changed. Verify the official artwork and crop before building.");
  BufferedImage poster=ImageIO.read(source.toFile());if(poster==null||poster.getWidth()!=1159||poster.getHeight()!=1536)throw new IllegalStateException("Unexpected official brochure dimensions");
  // Reviewed original-pixel bounds: complete event lettering and dandiya motif,
  // excluding the separate 'IS CALLING!' brochure sentence.
  BufferedImage mark=new BufferedImage(699,320,BufferedImage.TYPE_INT_RGB);
  Graphics2D mg=mark.createGraphics();mg.drawImage(poster,0,0,699,320,235,160,934,480,null);mg.dispose();
  png(mark,output.resolve("app/assets/art/navrang-wordmark.png"));
  png(mark,output.resolve("app/res/drawable/navrang_wordmark.png"));
  BufferedImage icon=new BufferedImage(512,512,BufferedImage.TYPE_INT_RGB);Graphics2D g=icon.createGraphics();
  g.setColor(new Color(0xfc,0xf3,0xe0));g.fillRect(0,0,512,512);
  g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BICUBIC);
  g.drawImage(mark,26,151,460,211,null);g.dispose();
  png(icon,output.resolve("app/assets/art/app-icon.png"));png(icon,output.resolve("app/res/drawable/app_icon.png"));
  System.out.println("Official brochure verified; exact Navrang mark and launcher artwork generated.");
 }
}
