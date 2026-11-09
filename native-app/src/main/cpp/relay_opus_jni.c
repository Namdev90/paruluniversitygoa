#include <jni.h>
#include <stdint.h>
#include "encoder_core.h"

static void wipe(void *memory,size_t size){volatile unsigned char *bytes=memory;while(size--)*bytes++=0;}

JNIEXPORT jlong JNICALL Java_in_navrang_gate_BundledRelayEncoder_nativeCreate(JNIEnv *env,jclass type){
    (void)env;(void)type;
    return (jlong)(intptr_t)navrang_encoder_create();
}
JNIEXPORT jint JNICALL Java_in_navrang_gate_BundledRelayEncoder_nativeEncode(JNIEnv *env,jclass type,jlong handle,jshortArray input,jbyteArray output){
    (void)type;
    if(!handle||!input||!output||(*env)->GetArrayLength(env,input)!=960||(*env)->GetArrayLength(env,output)!=2048)return -1;
    jshort pcm[960];unsigned char packet[2048];
    (*env)->GetShortArrayRegion(env,input,0,960,pcm);
    int result=-1;
    if(!(*env)->ExceptionCheck(env)){
        result=navrang_encoder_encode((NavrangEncoder *)(intptr_t)handle,(const int16_t *)pcm,960,packet,sizeof(packet));
        if(result>0)(*env)->SetByteArrayRegion(env,output,0,result,(const jbyte *)packet);
        if((*env)->ExceptionCheck(env))result=-1;
    }
    wipe(pcm,sizeof(pcm));wipe(packet,sizeof(packet));return result;
}
JNIEXPORT void JNICALL Java_in_navrang_gate_BundledRelayEncoder_nativeDestroy(JNIEnv *env,jclass type,jlong handle){
    (void)env;(void)type;
    if(handle)navrang_encoder_destroy((NavrangEncoder *)(intptr_t)handle);
}
