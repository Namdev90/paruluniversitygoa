/* Real pinned-libopus/core test. No JNI, Android device or microphone is used. */
#include "encoder_core.h"
#include "opus.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { \
    fprintf(stderr, "FAIL at line %d: %s\n", __LINE__, #condition); return 1; \
} } while (0)

int main(void) {
    int error = 0;
    NavrangEncoder *encoder = navrang_encoder_create();
    OpusDecoder *decoder = opus_decoder_create(48000, 1, &error);
    CHECK(encoder && decoder && error == OPUS_OK);
    int16_t pcm[960] = {0}, decoded[960];
    unsigned char packet[2048];
    CHECK(navrang_encoder_encode(NULL, pcm, 960, packet, 2048) == OPUS_BAD_ARG);
    CHECK(navrang_encoder_encode(encoder, NULL, 960, packet, 2048) == OPUS_BAD_ARG);
    CHECK(navrang_encoder_encode(encoder, pcm, 959, packet, 2048) == OPUS_BAD_ARG);
    CHECK(navrang_encoder_encode(encoder, pcm, 961, packet, 2048) == OPUS_BAD_ARG);
    CHECK(navrang_encoder_encode(encoder, pcm, 960, NULL, 2048) == OPUS_BAD_ARG);
    CHECK(navrang_encoder_encode(encoder, pcm, 960, packet, 59) == OPUS_BAD_ARG);
    CHECK(navrang_encoder_encode(encoder, pcm, 960, packet, 2049) == OPUS_BAD_ARG);
    uint32_t noise = 7;
    int packets = 0;
    for (int mode = 0; mode < 3; mode++) {
        for (int frame = 0; frame < 100; frame++) {
            for (int sample = 0; sample < 960; sample++) {
                noise = noise * 1664525U + 1013904223U;
                pcm[sample] = mode == 0 ? 0 : mode == 1
                    ? (int16_t)(10000 * sin((frame * 960 + sample) * 6.283185307179586 * 440 / 48000))
                    : (int16_t)(noise >> 16);
            }
            memset(packet, 0xa5, sizeof(packet));
            int length = navrang_encoder_encode(encoder, pcm, 960, packet, sizeof(packet));
            CHECK(length == 60);
            CHECK(opus_packet_get_nb_channels(packet) == 1);
            CHECK(opus_packet_get_nb_samples(packet, length, 48000) == 960);
            CHECK(opus_decode(decoder, packet, length, decoded, 960, 0) == 960);
            CHECK(packet[60] == 0xa5);
            packets++;
        }
    }
    navrang_encoder_destroy(encoder);
    navrang_encoder_destroy(NULL);
    opus_decoder_destroy(decoder);
    printf("PASS real libopus/core: %d mono 20ms 24kbps packets decoded; seven invalid inputs rejected.\n", packets);
    return 0;
}
