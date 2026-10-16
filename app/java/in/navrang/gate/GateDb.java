package in.navrang.gate;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.content.ContentValues;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
public final class GateDb extends SQLiteOpenHelper {
 private final Context context;
 public GateDb(Context c){super(c,"navrang-live-v2.db",null,1);context=c.getApplicationContext();setWriteAheadLoggingEnabled(true);getWritableDatabase();migrateLegacy();}
 public static String now(){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);f.setTimeZone(TimeZone.getTimeZone("UTC"));return f.format(new Date());}
 @Override public void onConfigure(SQLiteDatabase db){db.setForeignKeyConstraintsEnabled(true);db.execSQL("PRAGMA synchronous=FULL");}
 @Override public void onCreate(SQLiteDatabase db){
  try(InputStream in=context.getAssets().open("local-schema.sql");ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);
   for(String sql:new String(out.toByteArray(),StandardCharsets.UTF_8).split(";"))if(!sql.trim().isEmpty())db.execSQL(sql);
   putMeta(db,"deviceId","phone-"+UUID.randomUUID());putMeta(db,"dataRevision","-1");putMeta(db,"cursor","0");
  }catch(Exception e){throw new IllegalStateException("Local database could not initialize.",e);}
 }
 @Override public void onUpgrade(SQLiteDatabase db,int old,int next){throw new IllegalStateException("Unsupported local database upgrade; keep app data.");}
 private void putMeta(SQLiteDatabase db,String key,String value){ContentValues v=new ContentValues();v.put("key",key);v.put("value",value);if(db.insertWithOnConflict("meta",null,v,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new android.database.sqlite.SQLiteException("Metadata save failed.");}
 private String meta(String key,String fallback){try(Cursor c=getReadableDatabase().rawQuery("SELECT value FROM meta WHERE key=?",new String[]{key})){return c.moveToFirst()?c.getString(0):fallback;}}
 private int count(String table){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM "+table,null)){c.moveToFirst();return c.getInt(0);}}
 private void putJson(SQLiteDatabase db,String table,String id,JSONObject item)throws JSONException{
  ContentValues v=new ContentValues();v.put("id",id);v.put("json",item.toString());
  if("entries".equals(table)){
   v.put("seq",item.getLong("seq"));
   try(Cursor c=db.rawQuery("SELECT json FROM entries WHERE id=?",new String[]{id})){
    if(c.moveToFirst()){JSONObject old=new JSONObject(c.getString(0));for(String k:new String[]{"seq","ticketId","checkerId","checker","at","deviceId"})if(!old.optString(k).equals(item.optString(k)))throw new JSONException("Conflicting saved receipt. Keep the original history.");return;}
   }
   db.insertOrThrow("entries",null,v);
  }else if(db.insertWithOnConflict(table,null,v,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new android.database.sqlite.SQLiteException("Device save failed.");
 }
 private JSONObject item(String table,String id)throws JSONException{try(Cursor c=getReadableDatabase().rawQuery("SELECT json FROM "+table+" WHERE id=?",new String[]{id})){return c.moveToFirst()?new JSONObject(c.getString(0)):null;}}
 private JSONArray list(String table,String order,String limit)throws JSONException{JSONArray out=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT json FROM "+table+" ORDER BY "+order+" "+limit,null)){while(c.moveToNext())out.put(new JSONObject(c.getString(0)));}return out;}
 private void migrateLegacy(){
  if("yes".equals(meta("legacyMigrated","")))return;
  AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"navrang-state-v1.json"));
  File base=file.getBaseFile();JSONObject old=null;
  if(base.exists()||new File(base.getPath()+".bak").exists()){
   try(InputStream in=file.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>20*1024*1024)throw new IOException();out.write(b,0,n);}old=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));if(old.optInt("version")!=1||!"O9KL3".equals(old.optString("eventId")))throw new IOException();}
   catch(Exception e){throw new IllegalStateException("Your previous offline history could not be read. Keep app data and export from the previous version.",e);}
  }
  SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
  try{
   if(old!=null){JSONObject records=old.optJSONObject("records"),entries=old.optJSONObject("admissions");
    if(records!=null)for(Iterator<String> it=records.keys();it.hasNext();){String id=it.next();putJson(db,"tickets",id,records.getJSONObject(id));}
    if(entries!=null)for(Iterator<String> it=entries.keys();it.hasNext();){String id=it.next();putJson(db,"legacy_entries",id,entries.getJSONObject(id));}
    if(old.optString("deviceId","").length()>0)putMeta(db,"deviceId",old.getString("deviceId"));
   }
   putMeta(db,"legacyMigrated","yes");db.setTransactionSuccessful();
  }catch(Exception e){throw new IllegalStateException("Could not preserve previous entries; no entry is confirmed.",e);}finally{db.endTransaction();}
 }
 public synchronized JSONObject snapshot()throws JSONException{
  return new JSONObject().put("deviceId",meta("deviceId","")).put("dataRevision",Long.parseLong(meta("dataRevision","-1"))).put("cursor",Long.parseLong(meta("cursor","0"))).put("source",meta("source","")).put("lastSync",meta("lastSync","")).put("stats",new JSONObject(meta("stats","{}"))).put("localCount",count("tickets")).put("pending",count("outbox")).put("legacyCount",count("legacy_entries")).put("entries",list("entries","seq DESC","LIMIT 15"));
 }
 public synchronized JSONObject lookup(String id)throws JSONException{return new JSONObject().put("record",item("tickets",id)).put("entry",item("entries",id)).put("legacyEntry",item("legacy_entries",id));}
 public synchronized JSONObject queue(String ticket,String actor)throws JSONException{
  if(!ticket.matches("[A-Z0-9]{8}")||actor.isEmpty())throw new IllegalArgumentException("Sign in and scan an exact eight-character ticket ID.");
  SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
  try{try(Cursor c=db.rawQuery("SELECT body FROM outbox WHERE actor=? AND ticket_id=?",new String[]{actor,ticket})){if(c.moveToFirst()){JSONObject p=new JSONObject(c.getString(0));db.setTransactionSuccessful();return p;}}
   JSONObject p=new JSONObject().put("ticketId",ticket).put("requestId",UUID.randomUUID().toString()).put("deviceId",meta("deviceId","")).put("actor",actor);
   ContentValues v=new ContentValues();v.put("request_id",p.getString("requestId"));v.put("ticket_id",ticket);v.put("actor",actor);v.put("body",p.toString());v.put("created_at",now());db.insertOrThrow("outbox",null,v);db.setTransactionSuccessful();return p;
  }finally{db.endTransaction();}
 }
 public synchronized JSONObject pending(String actor)throws JSONException{
  try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM outbox WHERE actor=? ORDER BY created_at LIMIT 1",new String[]{actor})){return c.moveToFirst()?new JSONObject(c.getString(0)):null;}
 }
 public synchronized void finish(JSONObject pending,JSONObject result)throws JSONException{
  String code=result.optString("code");if(!Arrays.asList("admitted","duplicate","blocked","not_found").contains(code))throw new JSONException("Unconfirmed response.");
  if(!pending.getString("ticketId").equals(result.optString("id")))throw new JSONException("Response does not match pending ticket.");
  SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
  try{
   if("admitted".equals(code)||"duplicate".equals(code)){
    JSONObject entry=result.getJSONObject("entry");if(!pending.getString("ticketId").equals(entry.getString("ticketId")))throw new JSONException("Mismatched admission receipt.");
    if("admitted".equals(code)){String serverActor=entry.isNull("checkerId")?"admin":entry.getString("checkerId");if(!serverActor.equals(pending.getString("actor")))throw new JSONException("Admission belongs to another checker.");}
    putJson(db,"entries",entry.getString("ticketId"),entry);
   }
   if(db.delete("outbox","request_id=? AND actor=?",new String[]{pending.getString("requestId"),pending.getString("actor")})!=1)throw new JSONException("Pending request changed; keep the receipt for retry.");db.setTransactionSuccessful();
  }finally{db.endTransaction();}
 }
 public synchronized void applySync(JSONObject sync)throws JSONException{
  SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
  try{
   if(!sync.isNull("records")&&sync.has("records")&&sync.getLong("dataRevision")>=Long.parseLong(meta("dataRevision","-1"))){JSONArray records=sync.getJSONArray("records");db.delete("tickets",null,null);for(int i=0;i<records.length();i++){JSONObject r=records.getJSONObject(i);putJson(db,"tickets",r.getString("id"),r);}putMeta(db,"dataRevision",String.valueOf(sync.getLong("dataRevision")));}
   JSONArray entries=sync.optJSONArray("entries");if(entries!=null)for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);putJson(db,"entries",e.getString("ticketId"),e);}
   if(sync.has("cursor"))putMeta(db,"cursor",String.valueOf(Math.max(sync.getLong("cursor"),Long.parseLong(meta("cursor","0")))));if(sync.has("stats"))putMeta(db,"stats",sync.getJSONObject("stats").toString());putMeta(db,"source",sync.optString("source",meta("source","")));putMeta(db,"lastSync",now());db.setTransactionSuccessful();
  }finally{db.endTransaction();}
 }
 public synchronized void importLocal(JSONArray records,String source)throws JSONException{
  SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{db.delete("tickets",null,null);for(int i=0;i<records.length();i++){JSONObject r=records.getJSONObject(i);if(!r.getString("id").matches("[A-Z0-9]{8}"))throw new JSONException("Invalid ticket ID.");putJson(db,"tickets",r.getString("id"),r);}putMeta(db,"dataRevision","-1");putMeta(db,"source","Local file: "+source);db.setTransactionSuccessful();}finally{db.endTransaction();}
 }
 public synchronized JSONObject backup()throws JSONException{return snapshot().put("format","navrang.device-backup").put("version",2).put("records",list("tickets","id","")).put("allEntries",list("entries","seq","")).put("legacyEntries",list("legacy_entries","id","")).put("outbox",pendingList());}
 private JSONArray pendingList()throws JSONException{JSONArray a=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM outbox ORDER BY created_at",null)){while(c.moveToNext())a.put(new JSONObject(c.getString(0)));}return a;}
}
