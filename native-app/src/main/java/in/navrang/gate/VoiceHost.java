package in.navrang.gate;

import org.json.JSONObject;

/** Android ownership effects, kept separate from authorization and media. */
interface VoiceHost {
    boolean prepareReceiving();
    boolean prepareTransmitting();
    boolean backgroundReceptionAllowed();
    boolean requestMicrophonePermission();
    void transmissionStopped();
    void statusChanged(JSONObject status);
    void stopped();
}
