package in.navrang.gate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

/** Public data only: never opens a private key or contacts a service. */
public final class VerifyUpdateMetadata {
    public static void main(String[] args) throws Exception {
        if (args.length != 8) throw new IllegalArgumentException("Expected public certificate and metadata fields.");
        byte[] certificate = Files.readAllBytes(Path.of(args[0]));
        int code = Integer.parseInt(args[1]);
        long size = Long.parseLong(args[4]);
        String abi = "universal".equals(args[7]) ? null : args[7];
        UpdatePolicy.validateArtifact(code, args[2], args[3], size, args[5], abi);
        if (!UpdatePolicy.authentic(certificate, code, args[2], args[3], size, args[5], Base64.getDecoder().decode(args[6]))) {
            throw new IllegalArgumentException("Release metadata signature rejected.");
        }
    }
    private VerifyUpdateMetadata() {}
}
