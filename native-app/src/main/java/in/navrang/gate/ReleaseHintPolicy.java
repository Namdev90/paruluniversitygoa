package in.navrang.gate;

import java.util.Map;

/** Public cache invalidation, with no route, identity or download authority. */
public final class ReleaseHintPolicy {
    public static final String TOPIC="navrang-public-releases-v1";
    public static int parse(Map<String,String> value) {
        if(value==null||value.size()!=3||!"app-release".equals(value.get("kind"))||
            !String.valueOf(value.get("versionCode")).matches("[1-9][0-9]{0,9}")||
            !String.valueOf(value.get("sha256")).matches("[a-f0-9]{64}"))return 0;
        try{return Integer.parseInt(value.get("versionCode"));}catch(NumberFormatException malformed){return 0;}
    }
    private ReleaseHintPolicy() {}
}
