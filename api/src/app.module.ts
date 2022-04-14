import { INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './logger/logger.module';

export const appModuleDocumentation = (app: INestApplication): void => {
  const options = new DocumentBuilder()
    .setTitle('Quickstart API')
    .setDescription('Quickstart API Service')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);
};
@Module({
  imports: [LoggerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
