#ifndef TXIKI_BROWSER_H
#define TXIKI_BROWSER_H

#include <fcntl.h>
#include <stdint.h>
#include <sys/stat.h>

#ifndef S_IFMT
#define S_IFMT 0170000
#endif

#ifndef O_TRUNC
#define O_TRUNC 01000
#endif

#define htons(x) __builtin_bswap16(x)
#define ntohs(x) __builtin_bswap16(x)
#define htonl(x) __builtin_bswap32(x)
#define ntohl(x) __builtin_bswap32(x)

#define AF_UNSPEC 0
#define AF_INET 2
#define AF_INET6 10
#define INET6_ADDRSTRLEN 46

struct addrinfo {
  int ai_flags;
  int ai_family;
  int ai_socktype;
  int ai_protocol;
  unsigned int ai_addrlen;
  struct sockaddr *ai_addr;
  char *ai_canonname;
  struct addrinfo *ai_next;
};

struct sockaddr {
  unsigned short sa_family;
  char sa_data[14];
};

struct sockaddr_storage {
  unsigned short ss_family;
  char pad[126];
};

struct sockaddr_in {
  unsigned short sin_family;
  unsigned short sin_port;
  struct {
    uint32_t s_addr;
  } sin_addr;
  char sin_zero[8];
};

struct sockaddr_in6 {
  unsigned short sin6_family;
  unsigned short sin6_port;
  uint32_t sin6_flowinfo;
  struct {
    unsigned char s6_addr[16];
  } sin6_addr;
  uint32_t sin6_scope_id;
};

#endif
