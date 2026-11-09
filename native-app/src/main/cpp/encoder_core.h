#ifndef NAVRANG_ENCODER_CORE_H
#define NAVRANG_ENCODER_CORE_H
#include <stddef.h>
#include <stdint.h>
typedef struct NavrangEncoder NavrangEncoder;
NavrangEncoder *navrang_encoder_create(void);
int navrang_encoder_encode(NavrangEncoder *,const int16_t *,size_t,unsigned char *,size_t);
void navrang_encoder_destroy(NavrangEncoder *);
#endif
