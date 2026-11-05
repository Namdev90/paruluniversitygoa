import in.navrang.gate.UpdatePolicy;
import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.util.Arrays;
import java.util.Base64;
import java.util.Enumeration;

/** Private build subprocess: stdin password, nonsecret result only; no key export. */
public final class OriginalSignerTool {
    private static final String EXPECTED="0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce";
    public static void main(String[] args) {
        char[] password=null;
        boolean failed=false;
        try {
            if(args.length<2)throw new IllegalArgumentException();
            String line=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8)).readLine();
            if(line==null)throw new IllegalArgumentException();password=line.toCharArray();line=null;
            KeyStore store=KeyStore.getInstance("PKCS12");
            try(FileInputStream input=new FileInputStream(args[0])){store.load(input,password);}
            String selected=null;Certificate certificate=null;
            for(Enumeration<String> aliases=store.aliases();aliases.hasMoreElements();){
                String alias=aliases.nextElement();Certificate candidate=store.getCertificate(alias);
                if(store.isKeyEntry(alias)&&candidate!=null&&EXPECTED.equals(UpdatePolicy.digest(candidate.getEncoded()))){
                    if(selected!=null)throw new IllegalStateException();selected=alias;certificate=candidate;
                }
            }
            if(selected==null||!selected.matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalStateException();
            PrivateKey key=(PrivateKey)store.getKey(selected,password);
            String algorithm="RSA".equals(key.getAlgorithm())?"SHA256withRSA":"EC".equals(key.getAlgorithm())?"SHA256withECDSA":null;
            if(algorithm==null)throw new IllegalStateException();
            byte[] payload;
            if("verify".equals(args[1])&&args.length==2)payload=("navrang-private-signer-proof-v1\n"+EXPECTED).getBytes(StandardCharsets.UTF_8);
            else if("metadata".equals(args[1])&&args.length==7)payload=UpdatePolicy.manifestBytes(Integer.parseInt(args[2]),args[3],args[4],Long.parseLong(args[5]),args[6]);
            else throw new IllegalArgumentException();
            Signature signer=Signature.getInstance(algorithm);signer.initSign(key);signer.update(payload);byte[] proof=signer.sign();
            Signature verifier=Signature.getInstance(algorithm);verifier.initVerify(certificate.getPublicKey());verifier.update(payload);
            if(!verifier.verify(proof))throw new IllegalStateException();
            System.out.println("verify".equals(args[1])?selected:Base64.getEncoder().encodeToString(proof));
        } catch(Exception failure) {
            System.err.println("Original signing operation could not be verified.");failed=true;
        } finally {if(password!=null)Arrays.fill(password,'\0');}
        if(failed)System.exit(2);
    }
}
