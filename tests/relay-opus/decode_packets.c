#include "opus.h"
#include <stdio.h>
#include <stdlib.h>
int main(int argc,char **argv){
 if(argc!=2)return 2;FILE *f=fopen(argv[1],"rb");if(!f)return 2;
 int error=0,packets=0;OpusDecoder *d=opus_decoder_create(48000,1,&error);if(!d||error)return 2;
 unsigned char h[4],p[2048];opus_int16 pcm[960];
 while(fread(h,1,4,f)==4){
   unsigned int n=((unsigned)h[0]<<24)|((unsigned)h[1]<<16)|((unsigned)h[2]<<8)|h[3];
   if(n<2||n>2048||fread(p,1,n,f)!=n||opus_packet_get_nb_channels(p)!=1||opus_packet_get_nb_samples(p,n,48000)!=960||opus_decode(d,p,n,pcm,960,0)!=960){fprintf(stderr,"FAIL packet %d\n",packets);return 1;}packets++;
 }
 if(ferror(f)||!feof(f)||packets!=300)return 1;
 opus_decoder_destroy(d);fclose(f);printf("PASS libopus JNI packet decode: %d mono packets, 960 PCM16 samples each\n",packets);return 0;
}
