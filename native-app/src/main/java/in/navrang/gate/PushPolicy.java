package in.navrang.gate;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Platform-independent validation. A push is only an invalidation hint, never authority. */
public final class PushPolicy {
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");
    public static final long MAX_REVISION = 9007199254740991L;
    public static final class Envelope {
        public final String eventId, bindingId, domain;
        public final long revision;
        private Envelope(String eventId, String bindingId, long revision, String domain) {
            this.eventId = eventId; this.bindingId = bindingId; this.revision = revision; this.domain=domain;
        }
    }
    public static boolean id(String value) { return value != null && ID.matcher(value).matches(); }
    /** A refresh family is an existing identity; an access rotation is not a new device. */
    public static String ownerMaterial(String token,String family) {
        return id(family)?"family:"+family.toLowerCase(java.util.Locale.ROOT):token;
    }
    public static long revision(String value) {
        if (value == null || !value.matches("0|[1-9][0-9]{0,15}")) return -1;
        try { long parsed = Long.parseLong(value); return parsed <= MAX_REVISION ? parsed : -1; }
        catch (NumberFormatException ignored) { return -1; }
    }
    public static Envelope parse(Map<String, String> data) {
        if (data == null || data.size() < 3 || data.size() > 4 || !id(data.get("eventId")) || !id(data.get("bindingId"))) return null;
        for(String key:data.keySet())if(!"eventId".equals(key)&&!"bindingId".equals(key)&&!"revision".equals(key)&&!"domain".equals(key))return null;
        String domain=data.get("domain");
        if(data.containsKey("domain")&&!"records".equals(domain)&&!"staff".equals(domain)&&!"access".equals(domain)&&!"helpdesk".equals(domain))return null;
        long value = revision(data.get("revision"));
        return value < 0 ? null : new Envelope(data.get("eventId"), data.get("bindingId"), value,domain==null?"":domain);
    }
    /** A late feed must not cancel alerts received after its authoritative snapshot. */
    public static boolean canPrune(long feedRevision, long lastPrunedRevision, long lastReceivedRevision) {
        return feedRevision >= 0 && feedRevision <= MAX_REVISION &&
            feedRevision >= lastPrunedRevision && feedRevision >= lastReceivedRevision;
    }
    public static boolean canReceive(Envelope envelope, long lastPrunedRevision, boolean retainedByFeed) {
        return envelope != null && (envelope.revision > lastPrunedRevision || retainedByFeed);
    }
    public static boolean current(String owner, long generation, String currentOwner, long currentGeneration, boolean active) {
        return active && owner != null && !owner.isEmpty() && owner.equals(currentOwner) && generation == currentGeneration;
    }
    /** Bounded event revisions, scoped to one binding. Out-of-order different events remain eligible. */
    public static boolean claim(Map<String, Long> seen, Envelope envelope) {
        if (envelope == null || seen.getOrDefault(envelope.eventId, -1L) >= envelope.revision) return false;
        seen.remove(envelope.eventId); seen.put(envelope.eventId, envelope.revision);
        while (seen.size() > 64) seen.remove(seen.keySet().iterator().next());
        return true;
    }
    public static Map<String, Long> history() { return new LinkedHashMap<>(); }
    private PushPolicy() {}
}
