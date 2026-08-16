FROM registry.access.redhat.com/ubi9/nginx-120:latest

USER 0
COPY dist /opt/app-root/src
RUN chown -R 1001:0 /opt/app-root/src

USER 1001
EXPOSE 9443

CMD ["nginx", "-g", "daemon off;"]
