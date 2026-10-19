package in.navrang.gate;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import org.json.JSONObject;

/** On-demand, integrity-checked PUBLIC decoration. Never receives auth or attendee data. */
public final class RemoteArtwork {
 private static final int MAX_BYTES=2*1024*1024;
 private static final String PREFIX="file:///android_asset/";
 private static final String HOST="https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/";
 private static final byte[] FALLBACK=("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"300\" height=\"160\" viewBox=\"0 0 300 160\"><text x=\"150\" y=\"80\" text-anchor=\"middle\" fill=\"#E5BE7D\" font-size=\"28\">Navrang</text><text x=\"150\" y=\"110\" text-anchor=\"middle\" fill=\"#FFF2D6\" font-size=\"14\">Parul University Goa</text></svg>").getBytes(StandardCharsets.UTF_8);
 private final Context context;
 private final JSONObject images;
 interface Downloader { byte[] get(String url,int limit)throws Exception; }
 private final Downloader downloader;
 public RemoteArtwork(Context c){this(c,load(c),RemoteArtwork::download);}
 RemoteArtwork(Context c,JSONObject specification,Downloader fetch){context=c.getApplicationContext();images=specification;downloader=fetch;}
 private static JSONObject load(Context context){
  JSONObject manifest=new JSONObject();
  try(InputStream in=context.getAssets().open("remote-artwork.json")){
   JSONObject value=new JSONObject(new String(read(in,16384),StandardCharsets.UTF_8));
   if(value.optInt("schema")==1)manifest=value.getJSONObject("images");
  }catch(Exception ignored){}
  return manifest;
 }
 public WebResourceResponse intercept(Uri uri){
  String url=uri.toString();if(!url.startsWith(PREFIX)||uri.getQuery()!=null||uri.getFragment()!=null)return null;
  String name=url.substring(PREFIX.length());JSONObject image=images.optJSONObject(name);if(image==null)return null;
  try{
   String revision=image.getString("revision"),hash=image.getString("sha256"),mime=image.getString("mime");int size=image.getInt("size");
   if(!name.matches("art/[a-z0-9-]+\\.(png|webp)")||!revision.matches("[a-f0-9]{40}")||!hash.matches("[a-f0-9]{64}")||size<=0||size>MAX_BYTES)throw new IOException();
   File cache=new File(context.getCacheDir(),"navrang-public-art");
   if(!cache.isDirectory()&&!cache.mkdirs())throw new IOException();
   // The fixed three-entry manifest bounds public cache size; retire old content hashes.
   File[] previous=cache.listFiles();if(previous!=null)for(File old:previous){boolean keep=false;for(java.util.Iterator<String> it=images.keys();it.hasNext();)if(old.getName().equals(images.getJSONObject(it.next()).optString("sha256")))keep=true;if(!keep)old.delete();}
   File saved=new File(cache,hash);byte[] bytes=null;
   if(saved.isFile())try(InputStream in=new FileInputStream(saved)){byte[] candidate=read(in,size);if(valid(candidate,size,hash))bytes=candidate;}catch(Exception ignored){}
   if(bytes==null){
    bytes=downloader.get(HOST+revision+"/app/assets/"+name,size);
    if(!valid(bytes,size,hash))throw new IOException();
    // A partial write is harmless: every future cache read is verified again.
    try(FileOutputStream out=new FileOutputStream(saved)){out.write(bytes);}catch(IOException ignored){}
   }
   return response(mime,bytes);
  }catch(Exception ignored){return response("image/svg+xml",name.contains("combined")?FALLBACK:"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8));}
 }
 private static byte[] download(String url,int size)throws Exception{
  HttpURLConnection request=(HttpURLConnection)new URL(url).openConnection();
  request.setInstanceFollowRedirects(false);request.setConnectTimeout(2500);request.setReadTimeout(4000);request.setUseCaches(false);
  try{if(request.getResponseCode()!=200)throw new IOException();try(InputStream in=request.getInputStream()){return read(in,size);}}
  finally{request.disconnect();}
 }
 private static byte[] read(InputStream in,int limit)throws IOException{
  ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[8192];int n;
  while((n=in.read(block))!=-1){if(n>limit-out.size())throw new IOException("Public artwork exceeds its bound");out.write(block,0,n);}return out.toByteArray();
 }
 private static boolean valid(byte[] bytes,int size,String expected)throws Exception{
  if(bytes.length!=size)return false;byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder hash=new StringBuilder();for(byte b:digest)hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return expected.equals(hash.toString());
 }
 private static WebResourceResponse response(String mime,byte[] bytes){return new WebResourceResponse(mime,null,200,"OK",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(bytes));}
}
