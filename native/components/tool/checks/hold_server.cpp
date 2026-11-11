#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <thread>

namespace gm::tool {

namespace {

bool peer_closed(int fd) {
    char byte = 0;
    const ssize_t got = ::recv(fd, &byte, 1, MSG_PEEK | MSG_DONTWAIT);
    if (got == 0) return true;
    return got < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR;
}

void answer(int fd, const std::string& body) {
    const std::string response = "HTTP/1.1 200 OK\r\nContent-Length: " + std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
    ::send(fd, response.data(), response.size(), MSG_NOSIGNAL);
}

}

HoldServer::HoldServer(std::chrono::milliseconds hold, std::string body) : hold_(hold), body_(std::move(body)) {
    listen_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    int reuse = 1;
    ::setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof reuse);
    if (::bind(listen_fd_, reinterpret_cast<sockaddr*>(&address), sizeof address) != 0 || ::listen(listen_fd_, 16) != 0) return;
    socklen_t length = sizeof address;
    ::getsockname(listen_fd_, reinterpret_cast<sockaddr*>(&address), &length);
    port_ = ntohs(address.sin_port);
    accepter_ = std::thread([this] {
        for (;;) {
            const int client = ::accept(listen_fd_, nullptr, nullptr);
            if (client < 0) break;
            std::thread([this, client] { serve(client); }).detach();
        }
    });
}

HoldServer::~HoldServer() {
    if (listen_fd_ >= 0) ::shutdown(listen_fd_, SHUT_RDWR);
    if (listen_fd_ >= 0) ::close(listen_fd_);
    if (accepter_.joinable()) accepter_.join();
}

void HoldServer::serve(int client) {
    std::string request;
    char chunk[1024];
    while (request.find("\r\n\r\n") == std::string::npos) {
        const ssize_t got = ::recv(client, chunk, sizeof chunk, 0);
        if (got <= 0) break;
        request.append(chunk, static_cast<std::size_t>(got));
    }
    requested_.store(true);
    const std::size_t first_space = request.find(' ');
    const std::size_t second_space = first_space == std::string::npos ? std::string::npos : request.find(' ', first_space + 1);
    const std::string path = first_space != std::string::npos && second_space != std::string::npos ? request.substr(first_space + 1, second_space - first_space - 1) : "/";
    if (path.rfind("/fast", 0) == 0) {
        answer(client, body_);
        ::close(client);
        return;
    }
    const auto until = std::chrono::steady_clock::now() + hold_;
    while (std::chrono::steady_clock::now() < until) {
        if (peer_closed(client)) {
            std::lock_guard lock(mutex_);
            closed_at_ = std::chrono::steady_clock::now();
            ::close(client);
            return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    answer(client, body_);
    ::close(client);
}

int HoldServer::port() const { return port_; }

bool HoldServer::requested() const { return requested_.load(); }

std::optional<std::chrono::steady_clock::time_point> HoldServer::closed_at() const {
    std::lock_guard lock(mutex_);
    return closed_at_;
}

}
#endif
