package in.navrang.gate;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import javax.security.auth.x500.X500Principal;

/** Ephemeral test-only certificate/signature, never an APK identity or saved key. */
public final class ReleaseSignatureFixture {
    private static final KeyPair KEY;
    private static final byte[] CERTIFICATE;
    static {
        try {
            KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);KEY=generator.generateKeyPair();
            byte[] algorithm={48,13,6,9,42,(byte)134,72,(byte)134,(byte)247,13,1,1,11,5,0};
            byte[] name=new X500Principal("CN=Synthetic metadata fixture").getEncoded();
            byte[] validity=der(48,join(der(23,"260101000000Z".getBytes(StandardCharsets.US_ASCII)),der(23,"490101000000Z".getBytes(StandardCharsets.US_ASCII))));
            byte[] tbs=der(48,join(der(2,BigInteger.ONE.toByteArray()),algorithm,name,validity,name,KEY.getPublic().getEncoded()));
            CERTIFICATE=der(48,join(tbs,algorithm,der(3,join(new byte[]{0},sign(tbs)))));
        }catch(Exception failure){throw new ExceptionInInitializerError(failure);}
    }
    private static byte[] der(int tag,byte[] value) {
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(tag);
        if(value.length<128)out.write(value.length);
        else if(value.length<256){out.write(129);out.write(value.length);}
        else{out.write(130);out.write(value.length>>>8);out.write(value.length);}
        out.writeBytes(value);return out.toByteArray();
    }
    private static byte[] join(byte[]... values){ByteArrayOutputStream out=new ByteArrayOutputStream();for(byte[] value:values)out.writeBytes(value);return out.toByteArray();}
    public static byte[] certificate(){return CERTIFICATE.clone();}
    public static byte[] sign(byte[] value)throws Exception {
        Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign(KEY.getPrivate());signature.update(value);return signature.sign();
    }
    private ReleaseSignatureFixture() {}
}
