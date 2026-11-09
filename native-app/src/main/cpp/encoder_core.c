#include "encoder_core.h"
#include "opus.h"
#include <stdlib.h>
struct NavrangEncoder { int bytes; OpusEncoder *opus; };
static void wipe(void *p,size_t n){volatile unsigned char *v=p;while(n--)*v++=0;}
NavrangEncoder *navrang_encoder_create(void){
    NavrangEncoder *e=calloc(1,sizeof(*e)); if(!e)return NULL;
    e->bytes=opus_encoder_get_size(1);e->opus=malloc(e->bytes);
    if(!e->opus){free(e);return NULL;}
    if(opus_encoder_init(e->opus,48000,1,OPUS_APPLICATION_VOIP)!=OPUS_OK ||
       opus_encoder_ctl(e->opus,OPUS_SET_BITRATE(24000))!=OPUS_OK ||
       opus_encoder_ctl(e->opus,OPUS_SET_VBR(0))!=OPUS_OK ||
       opus_encoder_ctl(e->opus,OPUS_SET_DTX(0))!=OPUS_OK ||
       opus_encoder_ctl(e->opus,OPUS_SET_COMPLEXITY(5))!=OPUS_OK ||
       opus_encoder_ctl(e->opus,OPUS_SET_EXPERT_FRAME_DURATION(OPUS_FRAMESIZE_20_MS))!=OPUS_OK){
        navrang_encoder_destroy(e);return NULL;
    } return e;
}
int navrang_encoder_encode(NavrangEncoder *e,const int16_t *pcm,size_t count,unsigned char *out,size_t cap){
    if(!e||!pcm||count!=960||!out||cap<60||cap>2048)return OPUS_BAD_ARG;
    int n=opus_encode(e->opus,pcm,960,out,(opus_int32)cap);
    if(n<0)return n;
    const unsigned char *frames[48]; opus_int16 sizes[48]; int payload=0; unsigned char toc=0;
    int parsed=opus_packet_parse(out,n,&toc,frames,sizes,&payload);
    if(n<2||n>2048||parsed<1||opus_packet_get_nb_channels(out)!=1||opus_packet_get_nb_samples(out,n,48000)!=960){wipe(out,(size_t)n);return OPUS_INVALID_PACKET;}
    return n;
}
void navrang_encoder_destroy(NavrangEncoder *e){if(!e)return;if(e->opus){wipe(e->opus,e->bytes);free(e->opus);}wipe(e,sizeof(*e));free(e);}
