package in.navrang.gate;

/** RFC6716 TOC duration bound; codec1 admits only mono packets totaling nominal 20ms. */
final class RelayOpusPacket {
    private RelayOpusPacket(){}
    static boolean twentyMsMono(byte[] packet){
        if(packet==null||packet.length<2||packet.length>2048||(packet[0]&4)!=0)return false;
        int config=(packet[0]&255)>>>3,code=packet[0]&3;
        int samples=config>=16?(120<<(config&3)):config>=12?(480<<(config&1)):(config&3)==3?2880:480<<(config&3);
        int count=code==0?1:code<3?2:packet[1]&63;
        return count>0&&count<=48&&samples*count==960;
    }
}
